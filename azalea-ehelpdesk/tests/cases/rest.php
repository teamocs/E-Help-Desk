<?php
/**
 * Azl_Rest, Azl_Caps, Azl_Schema and the Snapshot shape.
 */

const DEVICE  = 10; // shared phone, azl_device
const MANAGER = 20; // azl_manager
const NOBODY  = 30; // a subscriber with no plugin caps

function sign_in_as( int $user ): void {
	$GLOBALS['azl_wp']['user'] = $user;
}

function give_roles(): void {
	Azl_Caps::install();
	$roles                       = $GLOBALS['azl_wp']['roles'];
	$GLOBALS['azl_wp']['caps']   = array(
		DEVICE  => $roles['azl_device']->capabilities,
		MANAGER => $roles['azl_manager']->capabilities,
		NOBODY  => array( 'read' => true ),
	);
}

function request( string $method, ?array $body = null, array $headers = array(), array $params = array() ): WP_REST_Request {
	$r = new WP_REST_Request( $method );
	if ( null !== $body ) {
		$r->set_body( json_encode( $body ) );
	}
	foreach ( $headers as $k => $v ) {
		$r->set_header( $k, $v );
	}
	foreach ( $params as $k => $v ) {
		$r->set_param( $k, $v );
	}
	return $r;
}

function a_request_body(): array {
	return array( 'type' => 'logRequest', 'opId' => id(), 'requestId' => id(), 'itemIds' => array( id() ), 'room' => '401', 'presets' => array( 'towels' ) );
}

test(
	'roles: device, supervisor and manager get their capabilities; administrators get all; install is repeatable',
	function () {
		$GLOBALS['azl_wp']['roles']['administrator'] = new Azl_Test_Role( array( 'manage_options' => true ) );
		Azl_Caps::install();
		Azl_Caps::install();
		$r = $GLOBALS['azl_wp']['roles'];
		eq( array( 'read' => true, 'azl_use_desk' => true ), $r['azl_device']->capabilities );
		eq( array( 'read' => true, 'azl_use_desk' => true, 'azl_act_directly' => true ), $r['azl_supervisor']->capabilities );
		ok( ! empty( $r['azl_manager']->capabilities['azl_manage_staff'] ) && ! empty( $r['azl_manager']->capabilities['azl_manage_settings'] ), 'manager' );
		foreach ( Azl_Caps::all() as $cap ) {
			ok( ! empty( $r['administrator']->capabilities[ $cap ] ), "administrator has $cap" );
		}
		ok( Azl_Caps::needs_staff( false, null ), 'device with nobody signed in' );
		ok( ! Azl_Caps::needs_staff( false, MARIA ), 'device with a PIN' );
		ok( ! Azl_Caps::needs_staff( true, null ), 'manager account' );
	}
);

test(
	'routes are registered with the right capability checks',
	function () {
		give_roles();
		Azl_Rest::register_routes();
		$routes = $GLOBALS['azl_wp']['routes'];
		foreach ( array( '/snapshot', '/command', '/poll', '/pin/sign-in', '/pin/sign-out', '/staff' ) as $path ) {
			ok( isset( $routes[ 'azl-ehd/v1' . $path ] ), "route $path" );
		}
		ok( 1 === count( preg_grep( '#^azl-ehd/v1/staff/\(\?P<id>#', array_keys( $routes ) ) ), 'PATCH /staff/<id>' );
		eq( array( Azl_Rest::class, 'can_use_desk' ), $routes['azl-ehd/v1/command']['permission_callback'] );
		eq( array( Azl_Rest::class, 'can_manage_staff' ), $routes['azl-ehd/v1/staff']['permission_callback'] );
		sign_in_as( NOBODY );
		ok( ! Azl_Rest::can_use_desk(), 'a plain subscriber cannot open the desk' );
		sign_in_as( DEVICE );
		ok( Azl_Rest::can_use_desk() && ! Azl_Rest::can_manage_staff() && ! Azl_Rest::can_manage_settings(), 'device' );
		sign_in_as( MANAGER );
		ok( Azl_Rest::can_manage_staff() && Azl_Rest::can_manage_settings(), 'manager' );
	}
);

test(
	'a command from a device account without acting staff is refused and writes nothing',
	function () {
		give_roles();
		sign_in_as( DEVICE );
		$before = fingerprint();
		$res    = Azl_Rest::command( request( 'POST', a_request_body() ) );
		eq( 403, $res->get_status() );
		eq( array( 'ok' => false, 'error' => Azl_Staff::SIGN_IN, 'code' => 'azl_needs_pin' ), $res->get_data() );
		$res = Azl_Rest::command( request( 'POST', a_request_body(), array( 'X-Azl-Actor' => 'forged.token' ) ) );
		eq( 403, $res->get_status() );
		eq( Azl_Staff::TOKEN_ENDED, $res->get_data()['error'] );
		eq( $before, fingerprint() );
	}
);

test(
	'PIN sign-in on a device gives a token; commands with it are recorded under that person',
	function () {
		give_roles();
		$joel_pin = '5821';
		Azl_Staff::change_pin( JOEL, $joel_pin );
		sign_in_as( DEVICE );
		$bad = Azl_Rest::pin_sign_in( request( 'POST', array( 'staffId' => JOEL, 'pin' => '0000' ) ) );
		eq( array( 'ok' => false, 'error' => Azl_Staff::WRONG ), $bad->get_data() );
		$in = Azl_Rest::pin_sign_in( request( 'POST', array( 'staffId' => JOEL, 'pin' => $joel_pin ) ) )->get_data();
		has( array( 'ok' => true, 'staff' => array( 'id' => JOEL, 'name' => 'Joel Dizon' ) ), $in );
		$body = a_request_body();
		$res  = Azl_Rest::command( request( 'POST', $body, array( 'X-Azl-Actor' => $in['token'] ) ) );
		eq( 200, $res->get_status() );
		has( array( 'ok' => true, 'applied' => true, 'ticketNo' => 1 ), $res->get_data() );
		eq( JOEL, Azl_Db::val( 'SELECT by_staff FROM ' . Azl_Db::t( 'events' ) . ' WHERE entity_id = %s', array( $body['requestId'] ) ) );
		eq( 'no-store, max-age=0', $res->get_headers()['Cache-Control'] );
		// The token is bound to the device account: another account cannot use it.
		sign_in_as( MANAGER );
		eq( 403, Azl_Rest::command( request( 'POST', a_request_body(), array( 'X-Azl-Actor' => $in['token'] ) ) )->get_status() );
		// Sign-out ends it.
		sign_in_as( DEVICE );
		azl_advance( 1 );
		Azl_Rest::pin_sign_out( request( 'POST' ) );
		eq( 403, Azl_Rest::command( request( 'POST', a_request_body(), array( 'X-Azl-Actor' => $in['token'] ) ) )->get_status() );
	}
);

test(
	'a manager account acts directly, as its linked staff row or as "a manager"',
	function () {
		give_roles();
		sign_in_as( MANAGER );
		$body = a_request_body();
		has( array( 'ok' => true ), Azl_Rest::command( request( 'POST', $body ) )->get_data() );
		eq( null, Azl_Db::val( 'SELECT logged_by FROM ' . Azl_Db::t( 'requests' ) . ' WHERE id = %s', array( $body['requestId'] ) ) );
		Azl_Staff::update( MARIA, array( 'wpUserId' => MANAGER ) );
		$body = a_request_body();
		Azl_Rest::command( request( 'POST', $body ) );
		eq( MARIA, Azl_Db::val( 'SELECT logged_by FROM ' . Azl_Db::t( 'requests' ) . ' WHERE id = %s', array( $body['requestId'] ) ) );
	}
);

test(
	'bad bodies get a JSON error, and a server fault never shows a stack trace',
	function () {
		give_roles();
		sign_in_as( MANAGER );
		$r = Azl_Rest::command( request( 'POST' ) );
		eq( 400, $r->get_status() );
		eq( array( 'ok' => false, 'error' => 'Unknown command' ), $r->get_data() );
		$r = Azl_Rest::command( request( 'POST', array( 'a', 'b' ) ) );
		eq( 400, $r->get_status() );
		$GLOBALS['wpdb']->pdo->exec( 'DROP TABLE wp_azl_seq' );
		$r = Azl_Rest::snapshot( request( 'GET' ) );
		eq( 500, $r->get_status() );
		eq( array( 'ok' => false, 'error' => 'Something went wrong. Try again.' ), $r->get_data() );
		eq( 'no-store, max-age=0', $r->get_headers()['Cache-Control'] );
	}
);

test(
	'poll is a single counter read with an ETag; 304 when nothing changed',
	function () {
		give_roles();
		sign_in_as( DEVICE );
		$first = Azl_Rest::poll( request( 'GET', null, array(), array( 'since' => 0 ) ) );
		eq( array( 'ok' => true, 'rev' => 0, 'changed' => false ), $first->get_data() );
		$etag = $first->get_headers()['ETag'];
		eq( '"azl-0"', $etag );
		$GLOBALS['wpdb']->log = array();
		eq( 304, Azl_Rest::poll( request( 'GET', null, array( 'If-None-Match' => $etag ) ) )->get_status() );
		eq( 1, count( $GLOBALS['wpdb']->log ), 'one query per poll' );
		cmd( array( 'type' => 'ackHandover', 'handoverId' => id() ) );
		$next = Azl_Rest::poll( request( 'GET', null, array( 'If-None-Match' => $etag ), array( 'since' => 0 ) ) );
		eq( 200, $next->get_status() );
		eq( array( 'ok' => true, 'rev' => 1, 'changed' => true ), $next->get_data() );
		eq( Azl_Snapshot::load()['rev'], 1 );
	}
);

test(
	'staff admin routes create and change people',
	function () {
		give_roles();
		sign_in_as( MANAGER );
		$made = Azl_Rest::create_staff( request( 'POST', array( 'name' => 'Lea Mendoza', 'title' => 'Engineer', 'role' => 'staff', 'dept' => 'engineering', 'pin' => '8352' ) ) )->get_data();
		has( array( 'ok' => true ), $made );
		eq( array( 'ok' => false, 'error' => Azl_Staff::WEAK ), Azl_Rest::create_staff( request( 'POST', array( 'name' => 'X', 'title' => 'Y', 'role' => 'staff', 'dept' => null, 'pin' => '2222' ) ) )->get_data() );
		$patch = request( 'PATCH', array( 'onShift' => false, 'pin_hash' => 'sneaky' ), array(), array( 'id' => $made['id'] ) );
		eq( array( 'ok' => true ), Azl_Rest::update_staff( $patch )->get_data() );
		$row = Azl_Db::row( 'SELECT on_shift, pin_hash FROM ' . Azl_Db::t( 'staff' ) . ' WHERE id = %s', array( $made['id'] ) );
		eq( '0', $row['on_shift'] );
		ok( 'sneaky' !== $row['pin_hash'], 'unknown fields are ignored' );
		eq( array( 'ok' => true ), Azl_Staff::check_pin( $made['id'], '8352' ) );
	}
);

/* ---------- schema ---------- */

test(
	'schema: dbDelta layout, every table, counters seeded, version stored, install repeatable',
	function () {
		foreach ( Azl_Schema::sql() as $sql ) {
			ok( false !== strpos( $sql, 'PRIMARY KEY  (' ), 'two spaces after PRIMARY KEY' );
			ok( ! preg_match( '/\bINDEX\b|FOREIGN KEY|REFERENCES/', $sql ), 'KEY not INDEX, no foreign keys' );
			ok( false !== strpos( $sql, 'ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4' ), 'InnoDB utf8mb4' );
			preg_match( '/CREATE TABLE (\w+)/', $sql, $m );
			$changeable = ! in_array( $m[1], array( 'wp_azl_events', 'wp_azl_handovers', 'wp_azl_seq' ), true );
			ok( ! $changeable || ( false !== strpos( $sql, 'created_at bigint' ) && false !== strpos( $sql, 'updated_at bigint' ) ), "$m[1] has created_at and updated_at" );
		}
		ok( false !== strpos( implode( '', Azl_Schema::sql() ), 'UNIQUE KEY op_entity_what (op_id,entity_id,what)' ), 'events unique on op + entity + what' );
		eq( Azl_Schema::VERSION, get_option( 'azl_db_version' ) );
		eq( array( 'change', 'inc', 'ticket', 'wo' ), array_column( Azl_Db::rows( 'SELECT name FROM ' . Azl_Db::t( 'seq' ) . ' ORDER BY name' ), 'name' ) );
		cmd( array( 'type' => 'ackHandover', 'handoverId' => id() ) );
		Azl_Schema::install();
		eq( 1, Azl_Db::counter( 'change' ), 'a second install keeps the counters' );
		eq( 1, (int) Azl_Db::val( 'SELECT COUNT(*) FROM ' . Azl_Db::t( 'handovers' ) ), 'and the data' );
		delete_option( 'azl_db_version' );
		Azl_Schema::maybe_upgrade();
		eq( Azl_Schema::VERSION, get_option( 'azl_db_version' ) );
	}
);

test(
	'the events table refuses a second row for the same op, entity and label',
	function () {
		$op = id();
		$e  = Azl_Db::t( 'events' );
		$sql = Azl_Db::insert_ignore() . " INTO $e (entity, entity_id, what, op_id, created_at) VALUES ('item', %s, 'Logged', %s, 1)";
		$x  = id();
		eq( 1, Azl_Db::exec( $sql, array( $x, $op ) ) );
		eq( 0, Azl_Db::exec( $sql, array( $x, $op ) ) );
		eq( 1, Azl_Db::exec( $sql, array( id(), $op ) ), 'same op, another entity' );
	}
);

/* ---------- snapshot ---------- */

test(
	'snapshot: a site name WordPress stores with HTML entities is shown as plain text',
	function () {
		$GLOBALS['azl_test_blogname'] = 'Azalea Hotels &amp; Residences Boracay';
		$name                         = Azl_Snapshot::load()['property']['name'];
		unset( $GLOBALS['azl_test_blogname'] );
		eq( 'Azalea Hotels & Residences Boracay', $name );
	}
);

test(
	'snapshot: same field names and JSON shape as the TypeScript Snapshot, empty objects as {}',
	function () {
		$empty = json_decode( json_encode( Azl_Snapshot::load() ) );
		eq( '{}', json_encode( $empty->items ) );
		eq( '{}', json_encode( $empty->handover ) );
		$snap_keys = array_keys( Azl_Snapshot::load() );
		sort( $snap_keys );
		eq( array( 'at', 'cleaning', 'handover', 'incidents', 'items', 'properties', 'property', 'requests', 'rev', 'seq', 'staff', 'wos' ), $snap_keys );

		list( $request, $items, $res ) = logged( '501', array( 'towels', 'water' ), array( 'vip' => true, 'remarks' => 'Guest <b>asleep</b>' ) );
		cmd( array( 'type' => 'relay', 'itemId' => $items[0] ) );
		$s = json_decode( json_encode( Azl_Snapshot::load() ), true );
		has( array( 'name' => 'Azalea Test Hotel' ), $s['property'] );
		ok( Azl_Db::is_uuid( $s['property']['id'] ), 'stable property id' );
		eq( array( $s['property'] ), $s['properties'] );
		eq( array( 't' => 1, 'wo' => 0, 'inc' => 0, 'id' => 0 ), $s['seq'] );
		eq( Azl_Db::now(), $s['at'] );
		eq(
			array( 'id' => $request, 'ticket' => 'T-0001', 'room' => '501', 'source' => 'staff', 'remarks' => 'Guest asleep', 'loggedBy' => MARIA, 'createdAt' => Azl_Db::now(), 'itemIds' => $items, 'incomplete' => false, 'vip' => true ),
			$s['requests'][0]
		);
		$it = $s['items'][ $items[0] ];
		eq(
			array( 'id', 'requestId', 'name', 'qty', 'dept', 'assignee', 'status', 'createdAt', 'ackAt', 'heldMs', 'slaMin', 'events' ),
			array_keys( $it )
		);
		has( array( 'qty' => 1, 'status' => 'relayed', 'assignee' => JOEL, 'heldMs' => 0, 'slaMin' => 10 ), $it );
		eq( array( array( 'at' => Azl_Db::now(), 'by' => MARIA, 'what' => 'Logged' ), array( 'at' => Azl_Db::now(), 'by' => MARIA, 'what' => 'Relayed' ) ), $it['events'] );
		eq( array( 'id' => MARIA, 'name' => 'Maria Santos', 'initials' => 'MS', 'role' => 'hdo', 'title' => 'Head Desk Officer', 'dept' => 'frontdesk', 'onShift' => true ), $s['staff'][0] );
		$inc = id();
		cmd( array( 'type' => 'raiseSafety', 'incidentId' => $inc, 'room' => '502', 'text' => 'amoy gas', 'hazard' => 'gas' ) );
		$i = Azl_Snapshot::load()['incidents'][0];
		eq( array( 'id' => $inc, 'no' => 'INC-001', 'hazard' => 'gas', 'rooms' => array( '502' ), 'createdAt' => Azl_Db::now(), 'text' => 'amoy gas', 'status' => 'active', 'log' => array( array( 'at' => Azl_Db::now(), 'by' => MARIA, 'what' => Azl_Commands::ALERT ) ) ), $i );
	}
);

test(
	'snapshot windows: 48 h requests unless open, 14 days for done work orders, 7 days for closed incidents, 24 h for done cleaning',
	function () {
		$day = 86400000;
		list( $closed, $ci ) = logged( '511', array( 'tv' ) );
		cmd( array( 'type' => 'finish', 'itemId' => $ci[0], 'status' => 'done' ) );
		list( $open )        = logged( '512', array( 'tv' ) );
		$done_wo             = id();
		$live_wo             = id();
		foreach ( array( $done_wo => 'done', $live_wo => 'in_progress' ) as $wo => $status ) {
			Azl_Db::insert( 'work_orders', array( 'id' => $wo, 'wo_no' => 'done' === $status ? 9001 : 9002, 'area' => 'Lobby', 'loc' => 'Lobby', 'descr' => "wo-$status", 'dept' => 'engineering', 'status' => $status, 'op_id' => id(), 'created_at' => Azl_Db::now(), 'updated_at' => Azl_Db::now() ) );
		}
		$resolved = id();
		$active   = id();
		cmd( array( 'type' => 'raiseSafety', 'incidentId' => $resolved, 'room' => '513', 'text' => 'baha', 'hazard' => 'flood' ) );
		cmd( array( 'type' => 'resolveIncident', 'incidentId' => $resolved ) );
		cmd( array( 'type' => 'raiseSafety', 'incidentId' => $active, 'room' => '514', 'text' => 'stuck', 'hazard' => 'lift' ) );
		$done_clean = clean_task( '515', 'done' );
		$open_clean = clean_task( '516', 'queued' );

		$ids = function ( $list ) {
			return array_column( $list, 'id' );
		};
		azl_advance( 47 * 3600000 );
		ok( in_array( $closed, $ids( Azl_Snapshot::load()['requests'] ), true ), 'closed request at 47 h' );
		azl_advance( 2 * 3600000 );
		$s = Azl_Snapshot::load();
		ok( ! in_array( $closed, $ids( $s['requests'] ), true ), 'closed request gone at 49 h' );
		ok( isset( $s['items']->{$ci[0]} ) === false, 'and its items' );
		ok( in_array( $open, $ids( $s['requests'] ), true ), 'open request kept' );
		ok( ! in_array( $done_clean, $ids( $s['cleaning'] ), true ) && in_array( $open_clean, $ids( $s['cleaning'] ), true ), 'cleaning after 24 h' );
		azl_advance( 6 * $day );
		$s = Azl_Snapshot::load();
		ok( ! in_array( $resolved, $ids( $s['incidents'] ), true ), 'resolved incident gone after 7 days' );
		ok( in_array( $active, $ids( $s['incidents'] ), true ), 'active incident kept' );
		ok( in_array( $done_wo, $ids( $s['wos'] ), true ), 'done work order kept at 8 days' );
		azl_advance( 7 * $day );
		$s = Azl_Snapshot::load();
		ok( ! in_array( $done_wo, $ids( $s['wos'] ), true ), 'done work order gone after 14 days' );
		ok( in_array( $live_wo, $ids( $s['wos'] ), true ), 'open work order kept' );
	}
);

test(
	'rules: the safety words and padding match the TypeScript',
	function () {
		eq( 'gas', Azl_Rules::detect_safety( 'Guest says amoy gas sa CR' ) );
		eq( 'smoke', Azl_Rules::detect_safety( 'May usok sa hallway' ) );
		eq( 'medical', Azl_Rules::detect_safety( "He can't breathe" ) );
		eq( null, Azl_Rules::detect_safety( 'Extra towels please' ) );
		eq( '0007', Azl_Rules::pad( 7 ) );
		eq( '007', Azl_Rules::pad( 7, 3 ) );
		eq( '2026-10-27T03:05:00.123Z', Azl_Snapshot::iso( Azl_Commands::iso_ms( '2026-10-27T11:05:00.123+08:00' ) ) );
	}
);
