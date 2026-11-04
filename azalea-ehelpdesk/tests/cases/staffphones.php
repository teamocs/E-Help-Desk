<?php
/**
 * Staff phones: the hotel switch (default off) and the per-department override. Department staff (role staff) use
 * the desk on a shared phone only while it is on for their department; the help desk, supervisors and managers
 * never depend on it. The runner turns it on before every test (set_staff_phones in run.php); these tests set it.
 */

/** A staff member's PIN, then the REST sign-in on the shared phone account. @return array the reply data */
function phone_sign_in( string $staff, string $pin ): array {
	Azl_Staff::change_pin( $staff, $pin );
	$GLOBALS['azl_wp']['user'] = ACC_PHONE;
	return Azl_Rest::pin_sign_in( request( 'POST', array( 'staffId' => $staff, 'pin' => $pin ) ) )->get_data();
}

/** Runs a command over REST with this token as the shared phone. @return array */
function phone_cmd( string $token, array $c ): array {
	$GLOBALS['azl_wp']['user'] = ACC_PHONE;
	return Azl_Rest::command( request( 'POST', $c + array( 'opId' => id() ), array( 'X-Azl-Actor' => $token ) ) )->get_data();
}

test(
	'staff phones: a fresh install and an upgraded one (no setting stored) are off, and refuse department staff but not the help desk',
	function () {
		access_accounts();
		delete_option( Azl_Catalog::OPTION );
		ok( ! array_key_exists( 'staffPhones', Azl_Catalog::get() ), 'the factory catalog stores nothing: absent means off' );
		eq( false, Azl_Catalog::staff_phones( Azl_Catalog::get(), 'housekeeping' ) );
		// An upgrade: a catalog stored by an earlier version has no setting either.
		$old = Azl_Catalog::get();
		update_option( Azl_Catalog::OPTION, wp_json_encode( $old ), false );
		eq( false, Azl_Catalog::staff_phones( Azl_Catalog::get(), 'engineering' ) );
		eq( array( 'kind' => 'none', 'dept' => null, 'staff' => null, 'off' => true ), Azl_Access::staff_kind( JOEL ) );
		eq( array( 'kind' => 'none', 'dept' => null, 'staff' => null, 'off' => true ), Azl_Access::who( ACC_PHONE, JOEL ) );
		eq( 'hdo', Azl_Access::staff_kind( MARIA )['kind'] );
		eq( 'supervisor', Azl_Access::staff_kind( LIZA )['kind'] );
		// A manager's or owner's staff row (role manager or owner) is a manager on the phone.
		$boss = id();
		Azl_Db::insert( 'staff', array( 'id' => $boss, 'name' => 'Duty Manager', 'initials' => 'DM', 'role' => 'manager', 'title' => 'Duty Manager', 'dept' => null, 'on_shift' => 1, 'active' => 1, 'pin_failed' => 0, 'created_at' => 2, 'updated_at' => 2 ) );
		eq( 'manager', Azl_Access::staff_kind( $boss )['kind'] );
		// Accounts: the WordPress role decides, whatever the switch.
		foreach ( array( ACC_OWNER => 'owner', ACC_MANAGER => 'manager', ACC_SUP => 'supervisor', ACC_ADMIN => 'owner' ) as $acc => $kind ) {
			eq( $kind, Azl_Access::who( $acc, JOEL )['kind'], "account $acc acting with a staff id" );
		}
	}
);

test(
	'staff phones: off refuses a department staff PIN sign-in with a plain message, the help desk still signs in',
	function () {
		access_accounts();
		set_staff_phones( null );
		$off = phone_sign_in( JOEL, '5821' );
		eq( array( 'ok' => false, 'error' => 'Staff phones are switched off at this hotel. Ask the help desk to log your work.', 'code' => 'azl_phones_off' ), $off );
		eq( Azl_Access::PHONES_OFF, $off['error'] );
		// A wrong PIN is still just a wrong PIN: nothing about the setting leaks to a stranger.
		$GLOBALS['azl_wp']['user'] = ACC_PHONE;
		eq( array( 'ok' => false, 'error' => Azl_Staff::WRONG ), Azl_Rest::pin_sign_in( request( 'POST', array( 'staffId' => JOEL, 'pin' => '0000' ) ) )->get_data() );
		has( array( 'ok' => true ), phone_sign_in( MARIA, '4417' ), 'help-desk officer' );
		has( array( 'ok' => true ), phone_sign_in( LIZA, '6153' ), 'supervisor' );
		set_staff_phones( true );
		has( array( 'ok' => true, 'staff' => array( 'id' => JOEL, 'name' => 'Joel Dizon' ) ), phone_sign_in( JOEL, '5821' ), 'on: staff sign in' );
	}
);

test(
	'staff phones: a token issued while it was on stops working when it is switched off, and works again when it is back on',
	function () {
		access_accounts();
		list( , $hk ) = logged( '931', array( 'towels' ) );
		$in = phone_sign_in( JOEL, '5821' );
		has( array( 'ok' => true ), $in );
		has( array( 'ok' => true, 'applied' => true ), phone_cmd( $in['token'], array( 'type' => 'relay', 'itemId' => $hk[0] ) ), 'on: Joel acts' );
		set_staff_phones( false );
		$before = fingerprint();
		eq( array( 'ok' => false, 'error' => Azl_Access::PHONES_OFF ), phone_cmd( $in['token'], array( 'type' => 'onSite', 'itemId' => $hk[0] ) ), 'the old token is refused with the plain message' );
		eq( array( 'ok' => false, 'error' => Azl_Access::PHONES_OFF ), phone_cmd( $in['token'], array( 'type' => 'logRequest', 'requestId' => id(), 'itemIds' => array( id() ), 'room' => '932', 'presets' => array( 'towels' ) ) ) );
		eq( $before, fingerprint(), 'nothing written' );
		// The snapshot he reads with that token has no module data at all.
		$GLOBALS['azl_wp']['user'] = ACC_PHONE;
		$snap = Azl_Rest::snapshot( request( 'GET', null, array( 'X-Azl-Actor' => $in['token'] ) ) )->get_data();
		eq( array(), (array) $snap['modules'], 'no module slices for a person who is off' );
		set_staff_phones( true );
		has( array( 'ok' => true, 'applied' => true ), phone_cmd( $in['token'], array( 'type' => 'onSite', 'itemId' => $hk[0] ) ), 'on again: the same token works' );
	}
);

test(
	'staff phones: a department can be switched off while the hotel switch is on, and a department flag cannot turn on what the hotel switch has off',
	function () {
		access_accounts();
		set_staff_phones( true, array( 'engineering' ) );
		eq( 'staff', Azl_Access::staff_kind( JOEL )['kind'], 'housekeeping follows the hotel switch' );
		eq( 'none', Azl_Access::staff_kind( RAMON )['kind'], 'engineering is off' );
		ok( true === Azl_Access::staff_kind( RAMON )['off'], 'and says why' );
		eq( array( 'ok' => false, 'error' => Azl_Access::PHONES_OFF ), array_intersect_key( phone_sign_in( RAMON, '7316' ), array( 'ok' => 1, 'error' => 1 ) ) );
		has( array( 'ok' => true ), phone_sign_in( JOEL, '5821' ) );
		list( , $en ) = logged( '933', array( 'ac' ) );
		eq( array( 'ok' => false, 'error' => Azl_Access::PHONES_OFF ), phone_cmd( Azl_Pin::sign_actor( ACC_PHONE, RAMON )['token'], array( 'type' => 'relay', 'itemId' => $en[0] ) ) );
		// Hotel off: every department is off, whatever its own flag says.
		set_staff_phones( false );
		eq( 'none', Azl_Access::staff_kind( JOEL )['kind'] );
		eq( 'none', Azl_Access::staff_kind( RAMON )['kind'] );
		// A department with no flag, and a person with no department, follow the hotel switch.
		ok( Azl_Catalog::staff_phones( array( 'staffPhones' => true, 'departments' => array() ), null ), 'no department: the hotel switch' );
		ok( ! Azl_Catalog::staff_phones( array( 'staffPhones' => 'yes', 'departments' => array() ), null ), 'only a real true turns it on' );
	}
);

test(
	'staff phones: the help desk, supervisor and manager act on any department\'s items whatever the setting, and the record names them',
	function () {
		access_accounts();
		set_staff_phones( false );
		list( , $en ) = logged( '934', array( 'ac' ) );
		$GLOBALS['azl_wp']['user'] = ACC_PHONE;
		has( array( 'ok' => true, 'applied' => true ), cmd( array( 'type' => 'relay', 'itemId' => $en[0] ), MARIA ), 'hdo relays an engineering item' );
		has( array( 'ok' => true, 'applied' => true ), cmd( array( 'type' => 'onSite', 'itemId' => $en[0] ), MARIA ), 'hdo marks it on site' );
		has( array( 'ok' => true, 'applied' => true ), cmd( array( 'type' => 'finish', 'itemId' => $en[0], 'status' => 'done' ), MARIA ), 'and done' );
		$by = Azl_Db::rows( 'SELECT what, by_staff FROM ' . Azl_Db::t( 'events' ) . ' WHERE entity_id = %s ORDER BY created_at, id', array( $en[0] ) );
		foreach ( $by as $e ) {
			if ( 'Logged' !== $e['what'] ) {
				eq( MARIA, $e['by_staff'], $e['what'] . ' is recorded under the help-desk officer' );
			}
		}
		list( , $hk ) = logged( '935', array( 'towels' ) );
		has( array( 'ok' => true, 'applied' => true ), cmd( array( 'type' => 'onSite', 'itemId' => $hk[0] ), LIZA ), 'supervisor on the phone' );
		$GLOBALS['azl_wp']['user'] = ACC_MANAGER;
		list( , $it ) = logged( '936', array( 'wifi' ) );
		has( array( 'ok' => true, 'applied' => true ), cmd( array( 'type' => 'onSite', 'itemId' => $it[0] ), null ), 'manager account' );
	}
);

test(
	'staff phones: only the hotel owner, a manager or an administrator can change the switch; answers, versions and validation',
	function () {
		access_accounts();
		Azl_Rest::register_routes();
		$route = $GLOBALS['azl_wp']['routes']['azl-ehd/v1/staff-phones'];
		eq( array( 'PUT', array( Azl_Rest::class, 'can_manage_lists' ) ), array( $route['methods'], $route['permission_callback'] ) );
		foreach ( array( ACC_OWNER => true, ACC_MANAGER => true, ACC_ADMIN => true, ACC_SUP => false, ACC_PHONE => false ) as $acc => $may ) {
			$GLOBALS['azl_wp']['user'] = $acc;
			eq( $may, Azl_Rest::can_manage_lists(), "account $acc" );
		}
		set_staff_phones( null );
		$GLOBALS['azl_wp']['user'] = ACC_MANAGER;
		$rev  = Azl_Catalog::get()['catalogRev'];
		$wake = Azl_Db::counter( 'change' );
		$res  = Azl_Rest::put_staff_phones( request( 'PUT', array( 'on' => true, 'baseRev' => $rev ) ) );
		eq( 200, $res->get_status() );
		eq( true, $res->get_data()['catalog']['staffPhones'] );
		eq( $rev + 1, $res->get_data()['catalog']['catalogRev'] );
		ok( is_array( $res->get_data()['catalog']['defs'] ), 'the answer carries the list definitions like the other saves' );
		ok( Azl_Db::counter( 'change' ) > $wake, 'phones refresh on their next poll' );
		eq( 'staff', Azl_Access::staff_kind( JOEL )['kind'], 'effective at once' );
		// Stale, not a switch, not JSON.
		$stale = Azl_Rest::put_staff_phones( request( 'PUT', array( 'on' => false, 'baseRev' => $rev ) ) );
		eq( 409, $stale->get_status() );
		has( array( 'code' => 'azl_stale' ), $stale->get_data() );
		eq( 'staff', Azl_Access::staff_kind( JOEL )['kind'], 'a stale save changes nothing' );
		eq( 400, Azl_Rest::put_staff_phones( request( 'PUT', array( 'on' => 'yes', 'baseRev' => $rev + 1 ) ) )->get_status() );
		eq( 400, Azl_Rest::put_staff_phones( request( 'PUT', array( 'baseRev' => $rev + 1 ) ) )->get_status() );
		eq( 400, Azl_Rest::put_staff_phones( request( 'PUT', null ) )->get_status() );
		$off = Azl_Rest::put_staff_phones( request( 'PUT', array( 'on' => false, 'baseRev' => $rev + 1 ) ) );
		eq( false, $off->get_data()['catalog']['staffPhones'] );
		eq( 'none', Azl_Access::staff_kind( JOEL )['kind'] );
		// The lists keep their own saves and leave the switch alone.
		$titles = Azl_Catalog::save( 'jobTitles', array(), $rev + 2 );
		eq( 200, $titles[0] );
		eq( false, Azl_Catalog::get()['staffPhones'] );
	}
);

test(
	'staff phones: the department flag is saved with the departments list (only "off" is stored) and checked',
	function () {
		access_accounts();
		set_staff_phones( true );
		$d = Azl_Catalog::get()['departments'];
		$d[0]['staffPhones'] = false;
		$d[1]['staffPhones'] = true;
		list( $status, $out ) = Azl_Catalog::save( 'departments', $d, Azl_Catalog::get()['catalogRev'] );
		eq( 200, $status );
		eq( false, $out['catalog']['departments'][0]['staffPhones'] );
		ok( ! array_key_exists( 'staffPhones', $out['catalog']['departments'][1] ), 'on = follow the hotel: nothing stored' );
		eq( true, $out['catalog']['staffPhones'], 'a department save keeps the hotel switch' );
		eq( 'none', Azl_Access::staff_kind( JOEL )['kind'], 'Housekeeping is off' );
		eq( 'staff', Azl_Access::staff_kind( RAMON )['kind'] );
		$d                   = Azl_Catalog::get()['departments'];
		$d[2]['staffPhones'] = 'no';
		list( $status, $bad ) = Azl_Catalog::save( 'departments', $d, Azl_Catalog::get()['catalogRev'] );
		eq( array( 400, 'Choose whether its staff may use shared phones.', 2 ), array( $status, $bad['error'], $bad['index'] ) );
		// The factory seed has no flag; a stored value that is not false is ignored.
		$cat                                      = Azl_Catalog::get();
		$cat['departments'][3]['staffPhones']     = 'junk';
		update_option( Azl_Catalog::OPTION, wp_json_encode( $cat ), false );
		ok( ! array_key_exists( 'staffPhones', Azl_Catalog::get()['departments'][3] ), 'a stored junk value is ignored' );
	}
);

test(
	'staff phones: the snapshot marks department staff who are off (the "Who\'s on shift?" picker hides them), and names stay for the records',
	function () {
		access_accounts();
		set_staff_phones( true, array( 'engineering' ) );
		$staff = array_column( Azl_Snapshot::load()['staff'], null, 'id' );
		ok( ! array_key_exists( 'phone', $staff[ JOEL ] ), 'housekeeping staff: offered' );
		eq( false, $staff[ RAMON ]['phone'], 'engineering staff: not offered' );
		eq( 'Ramon Cruz', $staff[ RAMON ]['name'], 'still listed, so old records show the name' );
		ok( ! array_key_exists( 'phone', $staff[ MARIA ] ) && ! array_key_exists( 'phone', $staff[ LIZA ] ), 'the help desk and supervisors are always offered' );
		set_staff_phones( null );
		$staff = array_column( Azl_Snapshot::load()['staff'], null, 'id' );
		eq( array( false, false, false, false ), array( $staff[ JOEL ]['phone'], $staff[ RAMON ]['phone'], $staff[ DENNIS ]['phone'], array_key_exists( 'phone', $staff[ MARIA ] ) ), 'off: no department staff offered, the help desk still is' );
		ok( ! isset( Azl_Snapshot::load()['catalog']['staffPhones'] ), 'the catalog tells the desk the switch is off by leaving it out' );
	}
);
