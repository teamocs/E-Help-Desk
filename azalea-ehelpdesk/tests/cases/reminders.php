<?php
/**
 * Reminders (includes/Modules/Reminders.php): both commands, validation, links, idempotent replay, who may use it
 * (a help-desk officer only their own and All HD Staff's), and the snapshot window.
 */

const NINA = 'a0a0a0a0-0000-4000-8000-000000000201'; // a second help-desk officer

function rem_nina(): void {
	Azl_Db::insert(
		'staff',
		array( 'id' => NINA, 'name' => 'Nina Perez', 'initials' => 'NP', 'role' => 'hdo', 'title' => 'Desk Officer', 'dept' => 'frontdesk', 'on_shift' => 1, 'active' => 1, 'pin_failed' => 0, 'created_at' => 1_700_000_000_050, 'updated_at' => 1_700_000_000_050 )
	);
}

function rem_row( string $id ): ?array {
	return Azl_Db::row( 'SELECT * FROM ' . Azl_Db::t( 'reminders' ) . ' WHERE id = %s', array( $id ) );
}

function rem_state(): array {
	return array( Azl_Db::rows( 'SELECT * FROM ' . Azl_Db::t( 'reminders' ) . ' ORDER BY created_at, id' ), fingerprint() );
}

/** Adds a reminder for All HD Staff unless told otherwise. @return array{0: string, 1: array} id and result */
function rem_add( array $extra = array(), ?string $actor = MARIA ): array {
	$id = id();
	azl_advance( 1 ); // a distinct created_at, so the order of equal due times is the order they were added
	$r  = cmd( $extra + array( 'type' => 'addReminder', 'reminderId' => $id, 'desc' => 'Pool check' ), $actor );
	return array( $id, $r );
}

/** What the snapshot sends to this reader (the shared phone's PIN token goes in the header like the desk sends it). */
function rem_slice( array $who, ?string $token = null ): ?array {
	if ( null === $token ) {
		unset( $_SERVER['HTTP_X_AZL_ACTOR'] );
	} else {
		$_SERVER['HTTP_X_AZL_ACTOR'] = $token;
	}
	try {
		$snap = json_decode( json_encode( Azl_Snapshot::load( $who ) ), true );
	} finally {
		unset( $_SERVER['HTTP_X_AZL_ACTOR'] );
	}
	return $snap['modules']['reminders'] ?? null;
}

test(
	'reminders: addReminder stores a pending reminder for All HD Staff with its time, notes and link text',
	function () {
		list( $req ) = logged( '305', array( 'ac' ) );
		$id            = id();
		$due           = Azl_Db::now() + 3600000;
		$r             = cmd( array( 'type' => 'addReminder', 'reminderId' => $id, 'desc' => '  Follow up <i>Engineering</i> - 305 AC ', 'dueAt' => $due, 'notes' => "Parts?\n<b>Ask</b>", 'linkType' => 'request', 'linkId' => $req, 'linkLabel' => 'IGNORED' ) );
		eq( array( 'ok' => true, 'applied' => true ), $r );
		has(
			array( 'descr' => 'Follow up Engineering - 305 AC', 'assignee' => null, 'due_at' => (string) $due, 'notes' => "Parts?\nAsk", 'status' => 'pending', 'link_type' => 'request', 'link_id' => $req, 'link_label' => 'T-0001', 'completed_at' => null, 'created_by' => MARIA, 'created_at' => (string) Azl_Db::now() ),
			rem_row( $id )
		);
		eq( array( 'Added' ), labels( $id ) );
		eq( 2, Azl_Db::counter( 'change' ), 'the request and the reminder each moved the poll counter' );
		// Everything optional left out: no due time, no notes, no link.
		list( $b ) = rem_add();
		has( array( 'assignee' => null, 'due_at' => null, 'notes' => null, 'link_type' => null, 'link_id' => null, 'link_label' => null ), rem_row( $b ) );
		// A reminder for one person, and a reference to a record that is not in this plugin's tables.
		$hs = id();
		list( $c ) = rem_add( array( 'assignee' => MARIA, 'linkType' => 'housestatus', 'linkId' => $hs, 'linkLabel' => ' HS-0007 <b>x</b>' ) );
		has( array( 'assignee' => MARIA, 'link_type' => 'housestatus', 'link_id' => $hs, 'link_label' => 'HS-0007 x' ), rem_row( $c ) );
		list( $d ) = rem_add( array( 'linkType' => 'crisis', 'linkId' => id() ) );
		eq( 'CR', rem_row( $d )['link_label'], 'with no label given, the type' );
	}
);

test(
	'reminders: every kind of link is checked: known types only, the record must exist when the plugin holds it, label from the server',
	function () {
		list( $req ) = logged( '412', array( 'towels' ) );
		list( $inq )   = inq_log();
		$woId          = id();
		list( , $items ) = logged( '413', array( 'ac' ) );
		cmd( array( 'type' => 'onSite', 'itemId' => $items[0] ) );
		cmd( array( 'type' => 'escalate', 'itemId' => $items[0], 'woId' => $woId ) );
		foreach ( array( array( 'request', $req, 'T-0001' ), array( 'workorder', $woId, 'WO-0001' ), array( 'inquiry', $inq, 'I-0001' ) ) as list( $type, $link, $label ) ) {
			list( $id, $r ) = rem_add( array( 'linkType' => $type, 'linkId' => $link ) );
			has( array( 'ok' => true ), $r, $type );
			eq( $label, rem_row( $id )['link_label'], $type );
		}
		$before = rem_state();
		foreach ( array( 'request', 'workorder', 'inquiry' ) as $type ) {
			eq( array( 'ok' => false, 'error' => 'That record was not found. Choose another, or None' ), cmd( array( 'type' => 'addReminder', 'reminderId' => id(), 'desc' => 'x', 'linkType' => $type, 'linkId' => id() ) ), "missing $type" );
		}
		eq( array( 'ok' => false, 'error' => 'Choose what to link the reminder to, or None' ), cmd( array( 'type' => 'addReminder', 'reminderId' => id(), 'desc' => 'x', 'linkType' => 'room', 'linkId' => $req ) ) );
		eq( array( 'ok' => false, 'error' => 'Choose what to link the reminder to, or None' ), cmd( array( 'type' => 'addReminder', 'reminderId' => id(), 'desc' => 'x', 'linkType' => array( 'request' ), 'linkId' => $req ) ) );
		eq( array( 'ok' => false, 'error' => 'Choose the record to link, or None' ), cmd( array( 'type' => 'addReminder', 'reminderId' => id(), 'desc' => 'x', 'linkType' => 'request' ) ) );
		eq( array( 'ok' => false, 'error' => 'Choose the record to link, or None' ), cmd( array( 'type' => 'addReminder', 'reminderId' => id(), 'desc' => 'x', 'linkId' => $req ) ) );
		eq( array( 'ok' => false, 'error' => 'Invalid id' ), cmd( array( 'type' => 'addReminder', 'reminderId' => id(), 'desc' => 'x', 'linkType' => 'request', 'linkId' => "1' OR '1'='1" ) ), 'an injection attempt is not even an id' );
		eq( array( 'ok' => false, 'error' => 'Invalid id' ), cmd( array( 'type' => 'addReminder', 'reminderId' => id(), 'desc' => 'x', 'linkType' => 'request', 'linkId' => null ) ), 'a null link id is not an id' );
		eq( $before, rem_state() );
	}
);

test(
	'reminders: every bad input is refused with a plain message and writes nothing',
	function () {
		rem_nina();
		$before = rem_state();
		$ok     = array( 'type' => 'addReminder', 'reminderId' => id(), 'desc' => 'Call James Lee' );
		$cases  = array(
			array( array( 'desc' => '' ), 'Describe what needs following up' ),
			array( array( 'desc' => '   ' ), 'Describe what needs following up' ),
			array( array( 'desc' => array( 'x' ) ), 'Describe what needs following up' ),
			array( array( 'desc' => str_repeat( 'd', 201 ) ), 'Keep the description under 200 characters' ),
			array( array( 'assignee' => 'someone' ), 'Choose someone from the help desk, or All HD Staff' ),
			array( array( 'assignee' => JOEL ), 'Choose someone from the help desk, or All HD Staff' ),
			array( array( 'assignee' => id() ), 'Choose someone from the help desk, or All HD Staff' ),
			array( array( 'dueAt' => '2026-10-30' ), 'Choose a valid date and time' ),
			array( array( 'dueAt' => 5 ), 'Choose a valid date and time' ),
			array( array( 'dueAt' => 9_999_999_999_999 ), 'Choose a valid date and time' ),
			array( array( 'dueAt' => 1.5e12 ), 'Choose a valid date and time' ),
			array( array( 'notes' => str_repeat( 'n', 2001 ) ), 'Keep the notes under 2000 characters' ),
		);
		foreach ( $cases as list( $patch, $why ) ) {
			eq( array( 'ok' => false, 'error' => $why ), cmd( $patch + $ok ), json_encode( $patch ) );
		}
		eq( array( 'ok' => false, 'error' => 'Invalid id' ), cmd( array( 'type' => 'addReminder', 'reminderId' => 'x', 'desc' => 'x' ) ) );
		eq( array( 'ok' => false, 'error' => 'Invalid id' ), cmd( array( 'type' => 'doneReminder' ) ) );
		eq( $before, rem_state(), 'nothing written' );
		eq( 0, Azl_Db::counter( 'change' ) );
		// Edges that are valid: the first and last allowed times, a person, and a person who left is not.
		has( array( 'ok' => true ), cmd( array( 'dueAt' => 946684800000, 'assignee' => NINA ) + $ok ) );
		has( array( 'ok' => true ), cmd( array( 'dueAt' => 4102444800000, 'reminderId' => id() ) + $ok ) );
		Azl_Db::update( 'staff', array( 'active' => 0 ), array( 'id' => NINA ) );
		eq( array( 'ok' => false, 'error' => 'Choose someone from the help desk, or All HD Staff' ), cmd( array( 'assignee' => NINA, 'reminderId' => id() ) + $ok ) );
	}
);

test(
	'reminders: Done finishes a pending reminder once (no undo, no edit); unknown and finished ones are refused',
	function () {
		list( $id ) = rem_add();
		azl_advance( 5000 );
		has( array( 'ok' => true, 'applied' => true ), cmd( array( 'type' => 'doneReminder', 'reminderId' => $id ) ) );
		has( array( 'status' => 'completed', 'completed_at' => (string) Azl_Db::now(), 'completed_by' => MARIA ), rem_row( $id ) );
		eq( array( 'Added', 'Done' ), labels( $id ) );
		$before = rem_state();
		eq( array( 'ok' => false, 'error' => 'This reminder is already done' ), cmd( array( 'type' => 'doneReminder', 'reminderId' => $id ) ) );
		eq( array( 'ok' => false, 'error' => 'Unknown reminder' ), cmd( array( 'type' => 'doneReminder', 'reminderId' => id() ) ) );
		eq( array( 'ok' => false, 'error' => 'This reminder was already added' ), cmd( array( 'type' => 'addReminder', 'reminderId' => $id, 'desc' => 'again' ) ), 'a reused id' );
		eq( $before, rem_state() );
	}
);

test(
	'reminders: both commands are idempotent: the same op again answers applied:false and changes nothing',
	function () {
		$id = id();
		list( $first, $again ) = twice( array( 'type' => 'addReminder', 'reminderId' => $id, 'desc' => 'VIP Room 501', 'dueAt' => Azl_Db::now() + 1000 ) );
		eq( true, $first['applied'] && ! $again['applied'] );
		eq( 1, count( Azl_Db::rows( 'SELECT id FROM ' . Azl_Db::t( 'reminders' ) ) ) );
		twice( array( 'type' => 'doneReminder', 'reminderId' => $id ) );
		eq( array( 'Added', 'Done' ), labels( $id ) );
		eq( array( 'completed' ), array_column( Azl_Db::rows( 'SELECT status FROM ' . Azl_Db::t( 'reminders' ) ), 'status' ) );
	}
);

test(
	'reminders: who may use it: owner, manager and supervisor change all; a help-desk officer only their own and All HD Staff; department staff nothing',
	function () {
		access_accounts();
		rem_nina();
		$as = static function ( int $account, ?string $actor, array $c ) {
			$GLOBALS['azl_wp']['user'] = $account;
			try {
				return cmd( $c, $actor );
			} finally {
				$GLOBALS['azl_wp']['user'] = 0;
			}
		};
		$add = static function ( array $x = array() ) {
			return $x + array( 'type' => 'addReminder', 'reminderId' => id(), 'desc' => 'Follow up' );
		};
		foreach ( array( 'owner' => ACC_OWNER, 'manager' => ACC_MANAGER, 'supervisor' => ACC_SUP, 'admin' => ACC_ADMIN ) as $name => $acc ) {
			has( array( 'ok' => true, 'applied' => true ), $as( $acc, null, $add( array( 'assignee' => NINA ) ) ), "$name adds for anyone" );
		}
		has( array( 'ok' => true ), $as( ACC_PHONE, LIZA, $add( array( 'assignee' => NINA ) ) ), 'a supervisor on a shared phone' );
		// The help-desk officer on a shared phone (Maria): All HD Staff and themselves.
		has( array( 'ok' => true ), $as( ACC_PHONE, MARIA, $add() ), 'for All HD Staff' );
		has( array( 'ok' => true ), $as( ACC_PHONE, MARIA, $add( array( 'assignee' => MARIA ) ) ), 'for themselves' );
		$refuse = array( 'ok' => false, 'error' => 'You can set reminders for yourself or for All HD Staff' );
		$before = rem_state();
		eq( $refuse, $as( ACC_PHONE, MARIA, $add( array( 'assignee' => NINA ) ) ), 'not for a colleague' );
		eq( $before, rem_state() );
		// Finishing: hers and All HD Staff's yes, Nina's no.
		list( $all )   = rem_add( array(), NINA );
		list( $hers )  = rem_add( array( 'assignee' => MARIA ), null );
		list( $nina )  = rem_add( array( 'assignee' => NINA ), null );
		has( array( 'ok' => true ), $as( ACC_PHONE, MARIA, array( 'type' => 'doneReminder', 'reminderId' => $all ) ), 'All HD Staff' );
		has( array( 'ok' => true ), $as( ACC_PHONE, MARIA, array( 'type' => 'doneReminder', 'reminderId' => $hers ) ), 'her own' );
		$before = rem_state();
		eq( array( 'ok' => false, 'error' => 'You can finish reminders that are yours or for All HD Staff' ), $as( ACC_PHONE, MARIA, array( 'type' => 'doneReminder', 'reminderId' => $nina ) ), 'a colleague\'s' );
		eq( $before, rem_state() );
		has( array( 'ok' => true ), $as( ACC_SUP, null, array( 'type' => 'doneReminder', 'reminderId' => $nina ) ), 'a supervisor finishes anyone\'s' );
		// Department staff and an empty phone.
		$none   = array( 'ok' => false, 'error' => 'Your role cannot use Reminders.' );
		$before = rem_state();
		foreach ( array( JOEL, RAMON ) as $person ) {
			eq( $none, $as( ACC_PHONE, $person, $add() ), 'department staff cannot add' );
			eq( $none, $as( ACC_PHONE, $person, array( 'type' => 'doneReminder', 'reminderId' => $all ) ), 'department staff cannot finish' );
		}
		eq( array( 'ok' => false, 'error' => Azl_Access::NO_PIN ), $as( ACC_PHONE, null, $add() ) );
		eq( $before, rem_state(), 'the refusals wrote nothing' );
	}
);

test(
	'reminders: the snapshot: pending first by due time (undated last), finished ones only for 7 days, counts = pending',
	function () {
		$base = Azl_Db::now();
		list( $later )  = rem_add( array( 'desc' => 'Later', 'dueAt' => $base + 7200000 ) );
		list( $none )   = rem_add( array( 'desc' => 'No time' ) );
		list( $over )   = rem_add( array( 'desc' => 'Overdue', 'dueAt' => $base - 7200000 ) );
		list( $fresh )  = rem_add( array( 'desc' => 'Finished today' ) );
		list( $stale )  = rem_add( array( 'desc' => 'Finished long ago' ) );
		cmd( array( 'type' => 'doneReminder', 'reminderId' => $stale ) );
		azl_advance( 8 * 86400000 );
		cmd( array( 'type' => 'doneReminder', 'reminderId' => $fresh ) );
		$slice = rem_slice( array( 'kind' => 'owner', 'dept' => null ) );
		eq( array( 'Overdue', 'Later', 'No time', 'Finished today' ), array_column( $slice['list'], 'desc' ) );
		eq( array( 'pending' => 3 ), $slice['counts'] );
		eq( array( 'id' => $fresh, 'desc' => 'Finished today', 'status' => 'completed', 'completedAt' => Azl_Db::now(), 'completedBy' => MARIA, 'createdBy' => MARIA, 'createdAt' => (int) rem_row( $fresh )['created_at'] ), $slice['list'][3] );
		eq( array( 'id' => $over, 'desc' => 'Overdue', 'dueAt' => $base - 7200000, 'status' => 'pending', 'createdBy' => MARIA, 'createdAt' => (int) rem_row( $over )['created_at'] ), $slice['list'][0] );
		// Link and assignee come through.
		list( $req ) = logged( '507', array( 'towels' ) );
		list( $x )     = rem_add( array( 'desc' => 'Linked', 'assignee' => MARIA, 'linkType' => 'request', 'linkId' => $req ) );
		$row = array_values( array_filter( rem_slice( array( 'kind' => 'owner', 'dept' => null ) )['list'], fn( $r ) => $r['id'] === $x ) )[0];
		eq( MARIA, $row['assignee'] );
		eq( array( 'type' => 'request', 'id' => $req, 'label' => 'T-0001' ), $row['link'] );
		ok( ! array_key_exists( 'assignee', $slice['list'][0] ), 'All HD Staff has no assignee' );
	}
);

test(
	'reminders: the snapshot follows the reader: a help-desk officer gets only their own and All HD Staff\'s; department staff get none',
	function () {
		access_accounts();
		rem_nina();
		list( $all )  = rem_add( array( 'desc' => 'For everyone' ) );
		list( $mine ) = rem_add( array( 'desc' => 'For Maria', 'assignee' => MARIA ), null );
		list( $nina ) = rem_add( array( 'desc' => 'For Nina', 'assignee' => NINA ), null );
		list( $done ) = rem_add( array( 'desc' => 'Nina finished', 'assignee' => NINA ), null );
		cmd( array( 'type' => 'doneReminder', 'reminderId' => $done ) );
		$names = static function ( ?array $s ): array {
			return null === $s ? array() : array_column( $s['list'], 'desc' );
		};
		$GLOBALS['azl_wp']['user'] = ACC_PHONE;
		$maria = Azl_Pin::sign_actor( ACC_PHONE, MARIA )['token'];
		$nina_t = Azl_Pin::sign_actor( ACC_PHONE, NINA )['token'];
		$hdo   = array( 'kind' => 'hdo', 'dept' => 'frontdesk' );
		eq( array( 'For everyone', 'For Maria' ), $names( rem_slice( $hdo, $maria ) ) );
		eq( array( 'pending' => 2 ), rem_slice( $hdo, $maria )['counts'], 'the badge counts what the officer sees' );
		eq( array( 'For everyone', 'For Nina', 'Nina finished' ), $names( rem_slice( $hdo, $nina_t ) ) );
		eq( array( 'For everyone' ), $names( rem_slice( $hdo ) ), 'an officer whose PIN token is missing still sees All HD Staff only' );
		eq( array( 'For everyone', 'For Maria', 'For Nina', 'Nina finished' ), $names( rem_slice( array( 'kind' => 'supervisor', 'dept' => null ) ) ) );
		eq( null, rem_slice( array( 'kind' => 'staff', 'dept' => 'housekeeping' ), $maria ), 'department staff: no slice' );
		eq( null, rem_slice( array( 'kind' => 'none', 'dept' => null ) ) );
		// Through the real REST route, with the PIN token on the request.
		$r = new WP_REST_Request( 'GET' );
		$r->set_header( 'X-Azl-Actor', $maria );
		$_SERVER['HTTP_X_AZL_ACTOR'] = $maria; // what WordPress exposes of the same header
		try {
			$rest = json_decode( json_encode( Azl_Rest::snapshot( $r )->get_data() ), true );
		} finally {
			unset( $_SERVER['HTTP_X_AZL_ACTOR'] );
		}
		eq( array( 'For everyone', 'For Maria' ), $names( $rest['modules']['reminders'] ) );
	}
);

test(
	'reminders: the table, its indexes and the list order work on the plugin install; no counter is needed',
	function () {
		$t = Azl_Db::t( 'reminders' );
		ok( null !== Azl_Db::val( "SELECT name FROM sqlite_master WHERE type = 'table' AND name = %s", array( $t ) ), 'table' );
		$idx = array_column( Azl_Db::rows( "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = %s", array( $t ) ), 'name' );
		foreach ( array( 'status_due', 'assignee_status', 'status_completed' ) as $k ) {
			ok( in_array( $t . '_' . $k, $idx, true ), "index $k" );
		}
		eq( array( 'reminders@1' ), array_values( preg_grep( '/^reminders@/', explode( ',', Azl_Modules::signature() ) ) ) );
		eq( array(), (new Azl_Module_Reminders())->sequences() );
	}
);
