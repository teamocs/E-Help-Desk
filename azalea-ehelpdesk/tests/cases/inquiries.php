<?php
/**
 * Inquiries (includes/Modules/Inquiries.php): every command, validation, idempotent replay, numbering, who may use it
 * and the snapshot window.
 */

function inq_rows(): array {
	return Azl_Db::rows( 'SELECT * FROM ' . Azl_Db::t( 'inquiries' ) . ' ORDER BY inq_no' );
}

function inq_row( string $id ): ?array {
	return Azl_Db::row( 'SELECT * FROM ' . Azl_Db::t( 'inquiries' ) . ' WHERE id = %s', array( $id ) );
}

/** The module's table and the plugin's tables: what a replay must not change. */
function inq_state(): array {
	return array( inq_rows(), fingerprint() );
}

/** Logs an inquiry (an in-house guest in 412 unless told otherwise). @return array{0: string, 1: array} id and result */
function inq_log( array $extra = array(), ?string $actor = MARIA ): array {
	$id = id();
	azl_advance( 1 ); // a distinct created_at, so the list order never depends on random ids
	$r  = cmd( $extra + array( 'type' => 'logInquiry', 'inquiryId' => $id, 'contactType' => 'in_house', 'name' => 'Mr. Santos', 'room' => '412', 'desc' => 'Late checkout' ), $actor );
	return array( $id, $r );
}

function inq_slice( array $who = array( 'kind' => 'owner', 'dept' => null ) ): ?array {
	$snap = json_decode( json_encode( Azl_Snapshot::load( $who ) ), true );
	return $snap['modules']['inquiries'] ?? null;
}

test(
	'inquiries: logInquiry stores the inquiry as I-0001, active, with the officer who logged it, and keeps its history',
	function () {
		list( $id, $r ) = inq_log( array( 'name' => '  Mr. <b>Santos</b> ', 'contactType' => 'external', 'room' => '  ', 'desc' => "Reservation Dec 20-23\n<script>x</script>" ) );
		eq( array( 'ok' => true, 'applied' => true, 'inquiryNo' => 1 ), $r );
		has(
			array( 'inq_no' => '1', 'contact_name' => 'Mr. Santos', 'contact_type' => 'external', 'room' => null, 'descr' => "Reservation Dec 20-23\nx", 'hdo' => MARIA, 'status' => 'active', 'closed_at' => null, 'quick_close' => '0', 'logged_by' => MARIA, 'created_at' => (string) Azl_Db::now() ),
			inq_row( $id )
		);
		eq( array( 'Logged' ), labels( $id ) );
		eq( 1, Azl_Db::counter( 'change' ), 'the poll counter moved' );
		// An officer chosen on the form wins over the person logging; a manager account with no staff row logs with no officer.
		list( $b ) = inq_log( array( 'hdo' => MARIA ), RAMON );
		eq( MARIA, inq_row( $b )['hdo'] );
		list( $c ) = inq_log( array(), RAMON );
		eq( null, inq_row( $c )['hdo'], 'engineering staff are not help-desk officers' );
	}
);

test(
	'inquiries: every bad input is refused with a plain message, before any write and without using a number',
	function () {
		$before = inq_state();
		$ok     = array( 'type' => 'logInquiry', 'inquiryId' => id(), 'contactType' => 'external', 'name' => 'Ana', 'desc' => 'Venue' );
		$cases  = array(
			array( array( 'contactType' => 'vip' ), 'Choose who is asking: in-house guest, external or checked-out guest' ),
			array( array( 'contactType' => 7 ), 'Choose who is asking: in-house guest, external or checked-out guest' ),
			array( array( 'contactType' => null ), 'Choose who is asking: in-house guest, external or checked-out guest' ),
			array( array( 'name' => '   ' ), 'Enter the name of who is asking' ),
			array( array( 'name' => array( 'x' ) ), 'Enter the name of who is asking' ),
			array( array( 'name' => str_repeat( 'n', 121 ) ), 'Keep the name under 120 characters' ),
			array( array( 'room' => str_repeat( '4', 41 ) ), 'Keep the room under 40 characters' ),
			array( array( 'desc' => '' ), 'Describe the inquiry' ),
			array( array( 'desc' => '<b></b>' ), 'Describe the inquiry' ),
			array( array( 'desc' => str_repeat( 'd', 2001 ) ), 'Keep the description under 2000 characters' ),
			array( array( 'hdo' => JOEL ), 'Choose a help desk officer from the list' ),
			array( array( 'hdo' => 'nobody' ), 'Choose a help desk officer from the list' ),
			array( array( 'hdo' => '' ), 'Choose a help desk officer from the list' ),
		);
		foreach ( $cases as list( $patch, $why ) ) {
			eq( array( 'ok' => false, 'error' => $why ), cmd( $patch + $ok ), json_encode( $patch ) );
		}
		eq( array( 'ok' => false, 'error' => 'Invalid id' ), cmd( array( 'type' => 'logInquiry', 'inquiryId' => 'nope' ) + $ok ) );
		eq( array( 'ok' => false, 'error' => 'Invalid id' ), cmd( array( 'type' => 'logInquiry' ) + array_diff_key( $ok, array( 'inquiryId' => 1 ) ) ) );
		eq( $before, inq_state(), 'nothing written' );
		eq( 0, Azl_Db::counter( 'inq' ), 'no number used' );
		eq( 0, Azl_Db::counter( 'change' ) );
	}
);

test(
	'inquiries: numbers are gap-free across refusals, replays and a reused id; a replay answers with the same number',
	function () {
		list( , $a ) = inq_log();
		cmd( array( 'type' => 'logInquiry', 'inquiryId' => id(), 'contactType' => 'external', 'name' => '', 'desc' => 'x' ) ); // refused
		$c = array( 'type' => 'logInquiry', 'opId' => id(), 'inquiryId' => id(), 'contactType' => 'checked_out', 'name' => 'James Lee', 'room' => '301', 'desc' => 'Left charger' );
		$b = cmd( $c );
		azl_advance( 1000 );
		$before = inq_state();
		eq( array( 'ok' => true, 'applied' => false, 'inquiryNo' => 2 ), cmd( $c ), 'the replay' );
		eq( $before, inq_state(), 'and changes nothing' );
		// A new op reusing the id of an existing inquiry is refused without using a number.
		eq( array( 'ok' => false, 'error' => 'This inquiry was already logged' ), cmd( array( 'opId' => id() ) + $c ) );
		list( , $d ) = inq_log();
		eq( array( 1, 2, 3 ), array( $a['inquiryNo'], $b['inquiryNo'], $d['inquiryNo'] ) );
		eq( 3, Azl_Db::counter( 'inq' ) );
		eq( array( '1', '2', '3' ), array_column( inq_rows(), 'inq_no' ) );
	}
);

test(
	'inquiries: Note, Done and Undo as the prototype has them, with the 6-minute quick-close flag',
	function () {
		list( $id ) = inq_log();
		has( array( 'ok' => true, 'applied' => true ), cmd( array( 'type' => 'noteInquiry', 'inquiryId' => $id ) ) );
		has( array( 'status' => 'noted', 'closed_at' => null ), inq_row( $id ) );
		// Undo on a noted inquiry makes it active again.
		has( array( 'ok' => true ), cmd( array( 'type' => 'reopenInquiry', 'inquiryId' => $id ) ) );
		eq( 'active', inq_row( $id )['status'] );
		// Done from noted, inside 6 minutes: flagged.
		cmd( array( 'type' => 'noteInquiry', 'inquiryId' => $id ) );
		azl_advance( 360000 );
		has( array( 'ok' => true ), cmd( array( 'type' => 'closeInquiry', 'inquiryId' => $id ) ) );
		has( array( 'status' => 'done', 'quick_close' => '1', 'closed_at' => (string) Azl_Db::now() ), inq_row( $id ), 'exactly 6 minutes is still quick' );
		// Undo on a done inquiry clears the close time and the flag.
		has( array( 'ok' => true ), cmd( array( 'type' => 'reopenInquiry', 'inquiryId' => $id ) ) );
		has( array( 'status' => 'active', 'closed_at' => null, 'quick_close' => '0' ), inq_row( $id ) );
		// Done straight from active, after 6 minutes: not flagged.
		list( $slow ) = inq_log();
		azl_advance( 360001 );
		cmd( array( 'type' => 'closeInquiry', 'inquiryId' => $slow ) );
		has( array( 'status' => 'done', 'quick_close' => '0' ), inq_row( $slow ) );
		eq( array( 'Logged', 'Noted', 'Reopened', 'Noted', 'Closed', 'Reopened' ), labels( $id ) );
	}
);

test(
	'inquiries: a step that does not fit the status is refused and writes nothing; unknown inquiries too',
	function () {
		list( $id ) = inq_log();
		$step       = static function ( string $type ) use ( $id ) {
			return cmd( array( 'type' => $type, 'inquiryId' => $id ) );
		};
		eq( array( 'ok' => false, 'error' => 'Already open' ), $step( 'reopenInquiry' ), 'Undo on an active inquiry' );
		cmd( array( 'type' => 'noteInquiry', 'inquiryId' => $id ) );
		eq( array( 'ok' => false, 'error' => 'Already noted or closed' ), $step( 'noteInquiry' ) );
		cmd( array( 'type' => 'closeInquiry', 'inquiryId' => $id ) );
		eq( array( 'ok' => false, 'error' => 'Already closed' ), $step( 'closeInquiry' ) );
		eq( array( 'ok' => false, 'error' => 'Already noted or closed' ), $step( 'noteInquiry' ), 'a closed inquiry cannot be noted' );
		$before = inq_state();
		eq( array( 'ok' => false, 'error' => 'Unknown inquiry' ), cmd( array( 'type' => 'closeInquiry', 'inquiryId' => id() ) ) );
		eq( array( 'ok' => false, 'error' => 'Invalid id' ), cmd( array( 'type' => 'closeInquiry', 'inquiryId' => 'x' ) ) );
		eq( array( 'ok' => false, 'error' => 'Invalid id' ), cmd( array( 'type' => 'closeInquiry' ) ) );
		eq( $before, inq_state() );
	}
);

test(
	'inquiries: every command is idempotent: the same op again answers applied:false and changes nothing',
	function () {
		list( $id ) = inq_log();
		foreach ( array( 'noteInquiry', 'closeInquiry', 'reopenInquiry' ) as $type ) {
			list( $first, $again ) = twice( array( 'type' => $type, 'inquiryId' => $id ) );
			eq( true, $first['applied'] && ! $again['applied'], $type );
		}
		eq( 'active', inq_row( $id )['status'] );
		eq( array( 'Logged', 'Noted', 'Closed', 'Reopened' ), labels( $id ), 'one history line per op' );
		// A replay of the very first op of a retried log, many times over.
		$c = array( 'type' => 'logInquiry', 'opId' => id(), 'inquiryId' => id(), 'contactType' => 'external', 'name' => 'Anna Reyes', 'desc' => 'Wedding venue' );
		cmd( $c );
		for ( $i = 0; $i < 3; $i++ ) {
			has( array( 'ok' => true, 'applied' => false, 'inquiryNo' => 2 ), cmd( $c ) );
		}
		eq( 2, count( inq_rows() ) );
	}
);

test(
	'inquiries: who may use it: the five desk actors per B.3; department staff on a shared phone and an empty phone are refused',
	function () {
		access_accounts();
		$as = static function ( int $account, ?string $actor, array $c ) {
			$GLOBALS['azl_wp']['user'] = $account;
			try {
				return cmd( $c, $actor );
			} finally {
				$GLOBALS['azl_wp']['user'] = 0;
			}
		};
		$log = static function () {
			return array( 'type' => 'logInquiry', 'inquiryId' => id(), 'contactType' => 'in_house', 'name' => 'Room 412', 'desc' => 'WiFi password' );
		};
		foreach ( array( 'owner' => ACC_OWNER, 'manager' => ACC_MANAGER, 'supervisor' => ACC_SUP, 'admin' => ACC_ADMIN ) as $name => $acc ) {
			has( array( 'ok' => true, 'applied' => true ), $as( $acc, null, $log() ), "$name account logs" );
		}
		has( array( 'ok' => true ), $as( ACC_PHONE, MARIA, $log() ), 'the help-desk officer on a shared phone' );
		has( array( 'ok' => true ), $as( ACC_PHONE, LIZA, $log() ), 'a supervisor on a shared phone' );
		eq( 6, count( inq_rows() ) );
		$before = inq_state();
		$refuse = array( 'ok' => false, 'error' => 'Your role cannot use Inquiries.' );
		$target = inq_rows()[0]['id'];
		foreach ( array( JOEL, RAMON ) as $person ) {
			eq( $refuse, $as( ACC_PHONE, $person, $log() ), 'department staff cannot log' );
			foreach ( array( 'noteInquiry', 'closeInquiry', 'reopenInquiry' ) as $type ) {
				eq( $refuse, $as( ACC_PHONE, $person, array( 'type' => $type, 'inquiryId' => $target ) ), "department staff: $type" );
			}
		}
		eq( array( 'ok' => false, 'error' => Azl_Access::NO_PIN ), $as( ACC_PHONE, null, $log() ), 'a shared phone with nobody signed in' );
		eq( $before, inq_state(), 'the refusals wrote nothing' );
		// A refusal is also the answer over REST for a replayed op (the role is checked before the replay).
		$op = id();
		has( array( 'ok' => true ), $as( ACC_PHONE, MARIA, $log() + array( 'opId' => $op ) ) );
		eq( $refuse, $as( ACC_PHONE, JOEL, $log() + array( 'opId' => id() ) ) );
	}
);

test(
	'inquiries: the snapshot slice goes only to readers of the module and shows the window: every open one plus the last 14 days',
	function () {
		access_accounts();
		list( $open ) = inq_log( array( 'name' => 'Open one' ) );
		list( $noted ) = inq_log( array( 'name' => 'Noted one' ) );
		cmd( array( 'type' => 'noteInquiry', 'inquiryId' => $noted ) );
		list( $old ) = inq_log( array( 'name' => 'Closed long ago' ) );
		cmd( array( 'type' => 'closeInquiry', 'inquiryId' => $old ) );
		azl_advance( 15 * 86400000 );
		list( $recent ) = inq_log( array( 'name' => 'Closed yesterday' ) );
		cmd( array( 'type' => 'closeInquiry', 'inquiryId' => $recent ) );
		$slice = inq_slice();
		eq( array( 'Closed yesterday', 'Noted one', 'Open one' ), array_column( $slice['list'], 'name' ), 'newest first; the old closed one is out of the window' );
		eq( array( 'active' => 1, 'noted' => 1 ), $slice['counts'], 'the badge numbers' );
		$first = $slice['list'][0];
		eq( array( 'id' => $recent, 'no' => 'I-0004', 'name' => 'Closed yesterday', 'type' => 'in_house', 'room' => '412', 'desc' => 'Late checkout', 'hdo' => MARIA, 'status' => 'done', 'createdAt' => Azl_Db::now(), 'closedAt' => Azl_Db::now(), 'quick' => true ), array_diff_key( $first, array( 'history' => 1 ) ) );
		eq( array( 'Logged', 'Closed' ), array_column( $first['history'], 'what' ) );
		eq( MARIA, $first['history'][0]['by'] );
		// Undo brings an old closed inquiry back into the list and the badge.
		cmd( array( 'type' => 'reopenInquiry', 'inquiryId' => $old ) );
		$slice = inq_slice();
		eq( 4, count( $slice['list'] ) );
		eq( 2, $slice['counts']['active'] );
		// The counts cover every row even when the list is cut (the list cap is 500, counts are separate queries).
		eq( 4, (int) Azl_Db::val( 'SELECT COUNT(*) FROM ' . Azl_Db::t( 'inquiries' ) ) );
		// Who gets the slice.
		foreach ( array( 'owner', 'manager', 'supervisor', 'hdo' ) as $kind ) {
			ok( null !== inq_slice( array( 'kind' => $kind, 'dept' => null ) ), "$kind reads Inquiries" );
		}
		eq( null, inq_slice( array( 'kind' => 'staff', 'dept' => 'housekeeping' ) ), 'department staff get no slice' );
		eq( null, inq_slice( array( 'kind' => 'none', 'dept' => null ) ), 'nobody signed in gets none' );
	}
);

test(
	'inquiries: the table is created by the plugin install, with its number counter and indexes for the list queries',
	function () {
		ok( null !== Azl_Db::val( "SELECT name FROM sqlite_master WHERE type = 'table' AND name = %s", array( Azl_Db::t( 'inquiries' ) ) ), 'table' );
		eq( 0, Azl_Db::counter( 'inq' ) );
		$t   = Azl_Db::t( 'inquiries' );
		$idx = array_column( Azl_Db::rows( "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = %s", array( $t ) ), 'name' );
		foreach ( array( 'status_created', 'updated_at' ) as $k ) {
			ok( in_array( $t . '_' . $k, $idx, true ), "index $k" );
		}
		$unique = array_filter( Azl_Db::rows( "PRAGMA index_list($t)" ), static function ( $i ) {
			return '1' === $i['unique'];
		} );
		eq( 3, count( $unique ), 'primary key, inq_no and op_id are unique' );
		eq( 'inquiries@1', implode( ',', preg_grep( '/^inquiries@/', explode( ',', Azl_Modules::signature() ) ) ) );
	}
);
