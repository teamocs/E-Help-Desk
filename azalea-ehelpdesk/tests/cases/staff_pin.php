<?php
/**
 * Azl_Pin and Azl_Staff: the port of src/server/staff.test.ts, in spirit.
 */

const PERSON = array( 'name' => 'Ana Reyes', 'title' => 'Room attendant', 'role' => 'staff', 'dept' => 'housekeeping' );

function add_person( string $pin, array $over = array() ): string {
	$r = Azl_Staff::create( array_merge( PERSON, $over ), $pin );
	has( array( 'ok' => true ), $r, 'create' );
	return $r['id'];
}

test(
	'PIN hashing verifies the right PIN only, salts each hash and is peppered with the site secret',
	function () {
		$h = Azl_Pin::hash( '4729' );
		ok( Azl_Pin::verify( '4729', $h ), 'right PIN' );
		ok( ! Azl_Pin::verify( '4728', $h ), 'wrong PIN' );
		ok( ! Azl_Pin::verify( '4729', 'garbage' ), 'garbage hash' );
		ok( ! Azl_Pin::verify( "4729\n", $h ), 'trailing newline' );
		ok( Azl_Pin::hash( '4729' ) !== $h, 'salted' );
		ok( ! password_verify( '4729', $h ), 'the bare PIN does not verify: a database copy alone is not enough' );
		update_option( Azl_Pin::SECRET_OPTION, str_repeat( 'b', 64 ) );
		ok( ! Azl_Pin::verify( '4729', $h ), 'a new site secret voids old PINs' );
	}
);

test(
	'weak PINs: repeats and straight runs',
	function () {
		foreach ( array( '0000', '7777', '1234', '4321', '3456', 'abcd', '123', '12345' ) as $p ) {
			ok( Azl_Pin::is_weak( $p ), "$p is weak" );
		}
		foreach ( array( '4729', '1357', '1212', '9081' ) as $p ) {
			ok( ! Azl_Pin::is_weak( $p ), "$p is fine" );
		}
	}
);

test(
	'the site secret is made once with random bytes and kept',
	function () {
		eq( false, get_option( Azl_Pin::SECRET_OPTION ) );
		$s = Azl_Pin::secret();
		eq( 64, strlen( $s ) );
		ok( ctype_xdigit( $s ), 'hex' );
		eq( $s, Azl_Pin::secret() );
		eq( $s, get_option( Azl_Pin::SECRET_OPTION ) );
	}
);

test(
	'creating staff validates input and refuses weak PINs',
	function () {
		eq( array( 'ok' => false, 'error' => Azl_Staff::WEAK ), Azl_Staff::create( PERSON, '1234' ) );
		eq( array( 'ok' => false, 'error' => Azl_Staff::PIN_FORMAT ), Azl_Staff::create( PERSON, '12a4' ) );
		has( array( 'ok' => false ), Azl_Staff::create( array_merge( PERSON, array( 'role' => 'owner' ) ), '4729' ) );
		has( array( 'ok' => false ), Azl_Staff::create( array_merge( PERSON, array( 'role' => 'manager' ) ), '4729' ) );
		has( array( 'ok' => false ), Azl_Staff::create( array_merge( PERSON, array( 'dept' => 'nope' ) ), '4729' ) );
		has( array( 'ok' => false ), Azl_Staff::create( array_merge( PERSON, array( 'name' => '  ' ) ), '4729' ) );
		$id  = add_person( '4729', array( 'name' => 'ana  maria reyes' ) );
		$row = Azl_Db::row( 'SELECT name, initials, on_shift, active, pin_hash FROM ' . Azl_Db::t( 'staff' ) . ' WHERE id = %s', array( $id ) );
		has( array( 'name' => 'ana maria reyes', 'initials' => 'AM', 'on_shift' => '1', 'active' => '1' ), $row );
		ok( 0 === strpos( $row['pin_hash'], '$2y$' ), 'stored with password_hash' );
		ok( false === strpos( json_encode( Azl_Snapshot::load() ), $row['pin_hash'] ), 'the snapshot never carries the PIN hash' );
	}
);

test(
	'a right PIN works, a wrong one does not, and a success clears the count',
	function () {
		$id = add_person( '4729' );
		eq( array( 'ok' => true ), Azl_Staff::check_pin( $id, '4729' ) );
		eq( array( 'ok' => false, 'error' => Azl_Staff::WRONG ), Azl_Staff::check_pin( $id, '4720' ) );
		eq( '1', Azl_Db::val( 'SELECT pin_failed FROM ' . Azl_Db::t( 'staff' ) . ' WHERE id = %s', array( $id ) ) );
		eq( array( 'ok' => true ), Azl_Staff::check_pin( strtoupper( $id ), '4729' ) );
		eq( '0', Azl_Db::val( 'SELECT pin_failed FROM ' . Azl_Db::t( 'staff' ) . ' WHERE id = %s', array( $id ) ) );
	}
);

test(
	'five wrong PINs lock that person for 15 minutes, even for the right PIN; others are unaffected',
	function () {
		$ben  = add_person( '5821', array( 'name' => 'Ben Cruz' ) );
		$cara = add_person( '6153', array( 'name' => 'Cara Dizon' ) );
		for ( $i = 0; $i < 4; $i++ ) {
			Azl_Staff::check_pin( $ben, '0000' );
		}
		eq( array( 'ok' => true ), Azl_Staff::check_pin( $ben, '5821' ), 'four wrong tries do not lock' );
		for ( $i = 0; $i < 5; $i++ ) {
			Azl_Staff::check_pin( $ben, '0000' );
		}
		eq( array( 'ok' => false, 'error' => Azl_Staff::WRONG ), Azl_Staff::check_pin( $ben, '5821' ), 'locked' );
		eq( array( 'ok' => true ), Azl_Staff::check_pin( $cara, '6153' ), 'per person, not per device' );
		azl_advance( 14 * 60000 );
		has( array( 'ok' => false ), Azl_Staff::check_pin( $ben, '5821' ), 'still locked at 14 minutes' );
		azl_advance( 61000 );
		eq( array( 'ok' => true ), Azl_Staff::check_pin( $ben, '5821' ), 'open again after 15 minutes' );
	}
);

test(
	'the wrong-PIN answer is identical for unknown, inactive, locked, malformed and no-PIN people',
	function () {
		$id    = add_person( '6153' );
		$wrong = Azl_Staff::check_pin( $id, '0000' );
		eq( array( 'ok' => false, 'error' => 'That name and PIN do not match.' ), $wrong );
		eq( $wrong, Azl_Staff::check_pin( id(), '6153' ), 'unknown' );
		eq( $wrong, Azl_Staff::check_pin( 'nobody', '6153' ), 'malformed id' );
		eq( $wrong, Azl_Staff::check_pin( $id, '61534' ), 'malformed PIN' );
		eq( $wrong, Azl_Staff::check_pin( MARIA, '6153' ), 'no PIN set' );
		$locked = add_person( '7392', array( 'name' => 'Dan Evora' ) );
		for ( $i = 0; $i < 5; $i++ ) {
			Azl_Staff::check_pin( $locked, '0000' );
		}
		eq( $wrong, Azl_Staff::check_pin( $locked, '7392' ), 'locked' );
		eq( array( 'ok' => true ), Azl_Staff::deactivate( $id ) );
		eq( $wrong, Azl_Staff::check_pin( $id, '6153' ), 'inactive' );
	}
);

test(
	'changing a PIN replaces the old one and clears a lockout',
	function () {
		$id = add_person( '7392' );
		for ( $i = 0; $i < 5; $i++ ) {
			Azl_Staff::check_pin( $id, '0000' );
		}
		eq( array( 'ok' => false, 'error' => Azl_Staff::WEAK ), Azl_Staff::change_pin( $id, '1111' ) );
		eq( array( 'ok' => true ), Azl_Staff::change_pin( $id, '8264' ) );
		has( array( 'ok' => false ), Azl_Staff::check_pin( $id, '7392' ) );
		eq( array( 'ok' => true ), Azl_Staff::check_pin( $id, '8264' ) );
		eq( array( 'ok' => false, 'error' => Azl_Staff::UNKNOWN ), Azl_Staff::change_pin( id(), '8264' ) );
	}
);

test(
	'update changes only what is sent; off shift and deactivated people leave the snapshot or the queue',
	function () {
		$id = add_person( '4729' );
		eq( array( 'ok' => true ), Azl_Staff::update( $id, array( 'title' => 'Senior attendant', 'onShift' => false ) ) );
		has( array( 'name' => 'Ana Reyes', 'title' => 'Senior attendant', 'on_shift' => '0', 'role' => 'staff' ), Azl_Db::row( 'SELECT * FROM ' . Azl_Db::t( 'staff' ) . ' WHERE id = %s', array( $id ) ) );
		eq( array( 'ok' => false, 'error' => 'Choose yes or no.' ), Azl_Staff::update( $id, array( 'onShift' => 'no' ) ) );
		eq( array( 'ok' => false, 'error' => 'Pick a role.' ), Azl_Staff::update( $id, array( 'role' => 'owner' ) ) );
		$ids = array_column( Azl_Snapshot::load()['staff'], 'id' );
		ok( in_array( $id, $ids, true ), 'off shift is still listed' );
		Azl_Staff::deactivate( $id );
		ok( ! in_array( $id, array_column( Azl_Snapshot::load()['staff'], 'id' ), true ), 'deactivated is not listed' );
		eq( array( 'ok' => false, 'error' => Azl_Staff::UNKNOWN ), Azl_Staff::update( $id, array( 'title' => 'x' ) ) );
	}
);

/* ---------- acting-staff token ---------- */

test(
	'the acting-staff token round-trips for the same WordPress user',
	function () {
		$t = Azl_Pin::sign_actor( 7, MARIA );
		eq( MARIA, Azl_Pin::read_actor( $t['token'], 7 ) );
		eq( Azl_Db::now() + 12 * 3600 * 1000, $t['expiresAt'] );
	}
);

test(
	'the token is refused when tampered, re-signed with another key, for another user, expired or signed out',
	function () {
		$t            = Azl_Pin::sign_actor( 7, MARIA )['token'];
		list( $b, $s ) = explode( '.', $t );
		$claims       = json_decode( base64_decode( strtr( $b, '-_', '+/' ) ), true );
		$forged_body  = rtrim( strtr( base64_encode( json_encode( array_merge( $claims, array( 's' => RAMON ) ) ) ), '+/', '-_' ), '=' );
		eq( null, Azl_Pin::read_actor( "$forged_body.$s", 7 ), 'body changed, old signature' );
		$own_sig = rtrim( strtr( base64_encode( hash_hmac( 'sha256', $forged_body, 'guess', true ) ), '+/', '-_' ), '=' );
		eq( null, Azl_Pin::read_actor( "$forged_body.$own_sig", 7 ), 'signed with a guessed key' );
		eq( null, Azl_Pin::read_actor( "$b.AAAA", 7 ), 'bad signature' );
		eq( null, Azl_Pin::read_actor( $b, 7 ), 'no signature' );
		eq( null, Azl_Pin::read_actor( "$t.x", 7 ), 'three parts' );
		eq( null, Azl_Pin::read_actor( $t, 8 ), 'another user' );
		eq( null, Azl_Pin::read_actor( $t, 0 ), 'signed-out visitor' );
		eq( null, Azl_Pin::read_actor( null, 7 ), 'missing' );
		azl_advance( 12 * 3600 * 1000 - 1 );
		eq( MARIA, Azl_Pin::read_actor( $t, 7 ), 'valid until the last millisecond' );
		azl_advance( 1 );
		eq( null, Azl_Pin::read_actor( $t, 7 ), 'expired after 12 hours' );

		$fresh = Azl_Pin::sign_actor( 7, MARIA )['token'];
		azl_advance( 1 );
		Azl_Pin::sign_out( 7 );
		eq( null, Azl_Pin::read_actor( $fresh, 7 ), 'signed out' );
		azl_advance( 1 );
		eq( MARIA, Azl_Pin::read_actor( Azl_Pin::sign_actor( 7, MARIA )['token'], 7 ), 'a new sign-in works after sign-out' );
	}
);

test(
	'a token from another site (another secret) is refused',
	function () {
		$t = Azl_Pin::sign_actor( 7, MARIA )['token'];
		update_option( Azl_Pin::SECRET_OPTION, str_repeat( 'c', 64 ) );
		eq( null, Azl_Pin::read_actor( $t, 7 ) );
	}
);
