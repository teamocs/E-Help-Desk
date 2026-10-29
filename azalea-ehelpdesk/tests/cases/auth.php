<?php
/**
 * Roles and the wp-admin lockdown, desk accounts, the sign-in pages and their REST routes,
 * security headers, and the theme tokens.
 */

const ADMIN_ID  = 1;
const OWNER_ID  = 2;
const OWNER2_ID = 3;
const MGR_ID    = 4;
const SUP_ID    = 5;
const PHONE_ID  = 6;
const SUB_ID    = 7;
const BOTH_ID   = 8; // azl_manager and administrator at once
const MIXED_ID  = 9; // azl_device and azl_owner at once: still an owner
const PASS      = 'correct horse 1';
const DESK      = AZL_TEST_HOME . '/helpdesk/';

/** Installs the roles and the usual cast of accounts. */
function cast(): void {
	$GLOBALS['azl_wp']['roles']['administrator'] = new Azl_Test_Role( array( 'manage_options' => true, 'read' => true ) );
	$GLOBALS['azl_wp']['roles']['subscriber']    = new Azl_Test_Role( array( 'read' => true ) );
	Azl_Caps::install();
	azl_add_user( ADMIN_ID, 'ocs@agency.test', array( 'administrator' ) );
	azl_add_user( OWNER_ID, 'owner@hotel.test', array( 'azl_owner' ) );
	azl_add_user( OWNER2_ID, 'owner2@hotel.test', array( 'azl_owner' ) );
	azl_add_user( MGR_ID, 'manager@hotel.test', array( 'azl_manager' ) );
	azl_add_user( SUP_ID, 'sup@hotel.test', array( 'azl_supervisor' ) );
	azl_add_user( PHONE_ID, 'phone@hotel.test', array( 'azl_device' ) );
	azl_add_user( SUB_ID, 'guest@hotel.test', array( 'subscriber' ) );
	azl_add_user( BOTH_ID, 'both@hotel.test', array( 'azl_manager', 'administrator' ) );
	azl_add_user( MIXED_ID, 'mixed@hotel.test', array( 'azl_device', 'azl_owner' ) );
}

function as_user( int $id ): void {
	$GLOBALS['azl_wp']['user'] = $id;
}

function post( array $body, array $headers = array(), array $params = array() ): WP_REST_Request {
	$r = new WP_REST_Request( 'POST' );
	$r->set_body( json_encode( $body ) );
	foreach ( $headers as $k => $v ) {
		$r->set_header( $k, $v );
	}
	foreach ( $params as $k => $v ) {
		$r->set_param( $k, $v );
	}
	return $r;
}

function sign_in( string $login, string $password, array $extra = array(), array $headers = array() ): WP_REST_Response {
	return Azl_Auth::login( post( $extra + array( 'login' => $login, 'password' => $password, 'remember' => false, 'csrf' => Azl_Auth::csrf_token() ), $headers ) );
}

/* ---------- roles ---------- */

test(
	'roles: exact capability matrix, read stored false, administrators hold every azl_* cap',
	function () {
		cast();
		$r = $GLOBALS['azl_wp']['roles'];
		eq( array( 'read' => false, 'azl_use_desk' => true, 'azl_act_directly' => true, 'azl_manage_staff' => true, 'azl_manage_accounts' => true ), $r['azl_owner']->capabilities );
		eq( array( 'read' => false, 'azl_use_desk' => true, 'azl_act_directly' => true, 'azl_manage_staff' => true ), $r['azl_manager']->capabilities );
		eq( array( 'read' => false, 'azl_use_desk' => true, 'azl_act_directly' => true ), $r['azl_supervisor']->capabilities );
		eq( array( 'read' => false, 'azl_use_desk' => true ), $r['azl_device']->capabilities );
		foreach ( array( 'azl_use_desk', 'azl_act_directly', 'azl_manage_staff', 'azl_manage_settings', 'azl_manage_accounts' ) as $cap ) {
			ok( true === $r['administrator']->capabilities[ $cap ], "administrator has $cap" );
		}
		$matrix = array(
			OWNER_ID => array( 'owner', true, true, true ),
			MGR_ID   => array( 'manager', true, true, false ),
			SUP_ID   => array( 'supervisor', true, false, false ),
			PHONE_ID => array( 'device', false, false, false ),
			ADMIN_ID => array( 'owner', true, true, true ),
		);
		foreach ( $matrix as $id => list( $role, $direct, $staff, $accounts ) ) {
			$u = get_userdata( $id );
			eq( $role, azl_ehd_desk_role( $u ), "desk role of $id" );
			eq( $direct, user_can( $u, 'azl_act_directly' ), "act directly $id" );
			eq( $staff, user_can( $u, 'azl_manage_staff' ), "manage staff $id" );
			eq( $accounts, user_can( $u, 'azl_manage_accounts' ), "manage accounts $id" );
			ok( ! user_can( $u, 'read' ) || ADMIN_ID === $id, "no core read for $id" );
		}
	}
);

test(
	'roles upgrade: old roles are repaired in place (labels, caps, stray core caps) and users keep them; runs once per version',
	function () {
		$GLOBALS['azl_wp']['roles']['azl_manager'] = new Azl_Test_Role( array( 'read' => true, 'azl_use_desk' => true, 'azl_act_directly' => true, 'azl_manage_staff' => true, 'azl_manage_settings' => true, 'edit_posts' => true ) );
		$GLOBALS['azl_wp']['roles']['azl_device']  = new Azl_Test_Role( array( 'read' => true, 'azl_use_desk' => true ) );
		azl_add_user( MGR_ID, 'manager@hotel.test', array( 'azl_manager' ) );
		Azl_Caps::maybe_upgrade();
		eq( Azl_Caps::role_caps( 'azl_manager' ), $GLOBALS['azl_wp']['roles']['azl_manager']->capabilities );
		eq( Azl_Caps::role_caps( 'azl_device' ), $GLOBALS['azl_wp']['roles']['azl_device']->capabilities );
		ok( isset( $GLOBALS['azl_wp']['roles']['azl_owner'] ), 'owner role added' );
		eq( array( 'azl_manager' ), get_userdata( MGR_ID )->roles, 'assignment kept' );
		eq( Azl_Caps::ROLES_VERSION, get_option( 'azl_roles_version' ) );
		// Same version: no work.
		$GLOBALS['azl_wp']['roles']['azl_manager']->add_cap( 'edit_posts' );
		Azl_Caps::maybe_upgrade();
		ok( true === $GLOBALS['azl_wp']['roles']['azl_manager']->capabilities['edit_posts'], 'not re-run' );
		update_option( 'azl_roles_version', '1' );
		Azl_Caps::maybe_upgrade();
		ok( ! isset( $GLOBALS['azl_wp']['roles']['azl_manager']->capabilities['edit_posts'] ), 're-run after a version change' );
	}
);

test(
	'lockdown: desk accounts are sent from wp-admin to the desk; administrators, ajax and admin-post are not',
	function () {
		cast();
		foreach ( array( OWNER_ID, MGR_ID, SUP_ID, PHONE_ID ) as $id ) {
			$u = get_userdata( $id );
			foreach ( array( 'index.php', 'profile.php', 'users.php', 'options.php' ) as $page ) {
				eq( DESK, Azl_Caps::admin_redirect( $u, $page, false ), "$id on $page" );
			}
			eq( null, Azl_Caps::admin_redirect( $u, 'admin-ajax.php', true ), "$id ajax" );
			eq( null, Azl_Caps::admin_redirect( $u, 'admin-post.php', false ), "$id admin-post" );
			as_user( $id );
			eq( false, Azl_Caps::admin_bar( true ), "$id admin bar" );
			eq( DESK, Azl_Caps::login_redirect( AZL_TEST_HOME . '/wp-admin/', '', $u ), "$id after wp-login.php" );
			eq( AZL_TEST_HOME . '/helpdesk/reports', Azl_Caps::login_redirect( AZL_TEST_HOME . '/wp-admin/', AZL_TEST_HOME . '/helpdesk/reports', $u ), "$id keeps a desk page" );
		}
		foreach ( array( ADMIN_ID, BOTH_ID, SUB_ID ) as $id ) {
			$u = get_userdata( $id );
			eq( null, Azl_Caps::admin_redirect( $u, 'index.php', false ), "$id passes" );
			eq( AZL_TEST_HOME . '/wp-admin/', Azl_Caps::login_redirect( AZL_TEST_HOME . '/wp-admin/', '', $u ), "$id login redirect untouched" );
			as_user( $id );
			eq( true, Azl_Caps::admin_bar( true ), "$id admin bar" );
		}
		eq( null, Azl_Caps::admin_redirect( new WP_User(), 'index.php', false ), 'signed out' );
		ok( in_array( array( Azl_Caps::class, 'guard_admin' ), $GLOBALS['azl_hooks']['admin_init'], true ), 'hooked on admin_init' );
		ok( in_array( array( Azl_Caps::class, 'guard_admin' ), $GLOBALS['azl_hooks']['admin_page_access_denied'], true ), 'and before the access-denied screen' );
	}
);

/* ---------- accounts ---------- */

test(
	'accounts: only owners and administrators may manage them; the list never shows admins or other owners',
	function () {
		cast();
		Azl_Accounts::register_routes();
		ok( isset( $GLOBALS['azl_wp']['routes']['azl-ehd/v1/accounts'] ), 'route /accounts' );
		foreach ( array( MGR_ID => false, SUP_ID => false, PHONE_ID => false, SUB_ID => false, 0 => false, OWNER_ID => true, ADMIN_ID => true ) as $id => $can ) {
			as_user( $id );
			eq( $can, Azl_Accounts::can_manage(), "can manage accounts: $id" );
		}
		as_user( OWNER_ID );
		$list = Azl_Accounts::list( new WP_REST_Request( 'GET' ) )->get_data()['accounts'];
		eq( array( OWNER_ID, MGR_ID, SUP_ID, PHONE_ID ), array_column( $list, 'id' ) );
		eq( array( 'owner', 'manager', 'supervisor', 'device' ), array_column( $list, 'role' ) );
		eq( true, $list[0]['self'] );
		eq( array( 'id', 'name', 'email', 'role', 'disabled' ), array_keys( $list[1] ) );
	}
);

test(
	'accounts: create sends a password link to /helpdesk/reset/; duplicates and other roles are refused',
	function () {
		cast();
		as_user( OWNER_ID );
		$res = Azl_Accounts::create( post( array( 'name' => 'Ana Reyes', 'email' => 'Ana@Hotel.test', 'role' => 'supervisor' ) ) );
		eq( 201, $res->get_status() );
		$acc = $res->get_data()['account'];
		has( array( 'name' => 'Ana Reyes', 'email' => 'ana@hotel.test', 'role' => 'supervisor', 'disabled' => false ), $acc );
		$user = get_userdata( $acc['id'] );
		eq( 'ana@hotel.test', $user->user_login );
		eq( array( 'azl_supervisor' ), $user->roles );
		$mail = end( $GLOBALS['azl_wp']['mails'] );
		eq( 'ana@hotel.test', $mail['to'] );
		ok( 1 === preg_match( '#' . preg_quote( AZL_TEST_HOME . '/helpdesk/reset/?key=', '#' ) . '[A-Za-z0-9]{20}&login=ana%40hotel.test#', $mail['body'] ), 'link to the desk reset page' );
		ok( false === strpos( $mail['body'], 'wp-login' ), 'no wp-login link' );

		$dup = Azl_Accounts::create( post( array( 'name' => 'X', 'email' => 'ANA@hotel.test', 'role' => 'device' ) ) );
		eq( 409, $dup->get_status() );
		eq( Azl_Accounts::EXISTS, $dup->get_data()['error'] );
		foreach ( array( 'owner', 'administrator', 'azl_manager', '' ) as $bad ) {
			eq( 400, Azl_Accounts::create( post( array( 'name' => 'X', 'email' => "x$bad@hotel.test", 'role' => $bad ) ) )->get_status(), "role $bad" );
		}
		eq( 400, Azl_Accounts::create( post( array( 'name' => 'X', 'email' => 'not-an-email', 'role' => 'device' ) ) )->get_status() );
		eq( 400, Azl_Accounts::create( post( array( 'name' => '', 'email' => 'y@hotel.test', 'role' => 'device' ) ) )->get_status() );
	}
);

test(
	'accounts: disable ends sessions and sign-in; admins, owners and yourself cannot be touched',
	function () {
		cast();
		as_user( OWNER_ID );
		foreach ( array( ADMIN_ID, OWNER2_ID, OWNER_ID, BOTH_ID, MIXED_ID, SUB_ID, 999 ) as $id ) {
			$r = Azl_Accounts::update( post( array( 'disabled' => true ), array(), array( 'id' => $id ) ) );
			eq( 404, $r->get_status(), "target $id" );
			eq( '', get_user_meta( $id, Azl_Auth::DISABLED, true ), "target $id untouched" );
		}
		eq( array(), $GLOBALS['azl_wp']['destroyed'] );
		$r = Azl_Accounts::update( post( array( 'disabled' => true ), array(), array( 'id' => MGR_ID ) ) );
		eq( 200, $r->get_status() );
		eq( true, $r->get_data()['account']['disabled'] );
		eq( array( MGR_ID ), $GLOBALS['azl_wp']['destroyed'], 'sessions destroyed' );
		as_user( 0 );
		eq( 401, sign_in( 'manager@hotel.test', PASS )->get_status(), 'a disabled account cannot sign in' );
		ok( is_wp_error( wp_authenticate( 'manager@hotel.test', PASS ) ), 'nor through wp-login.php' );
		as_user( OWNER_ID );
		eq( 400, Azl_Accounts::update( post( array( 'disabled' => 'yes' ), array(), array( 'id' => MGR_ID ) ) )->get_status() );
		Azl_Accounts::update( post( array( 'disabled' => false ), array(), array( 'id' => MGR_ID ) ) );
		as_user( 0 );
		eq( 200, sign_in( 'manager@hotel.test', PASS )->get_status(), 'enabled again' );
	}
);

/* ---------- sign-in ---------- */

test(
	'login: success sets the cookie (secure; phones always remembered) and goes to a safe desk page',
	function () {
		cast();
		$r = sign_in( 'sup@hotel.test', PASS, array( 'redirectTo' => AZL_TEST_HOME . '/helpdesk/work-orders' ) );
		eq( 200, $r->get_status() );
		eq( array( 'ok' => true, 'redirect' => AZL_TEST_HOME . '/helpdesk/work-orders' ), $r->get_data() );
		eq( array( SUP_ID, false, true ), $GLOBALS['azl_wp']['cookie'] );
		sign_in( 'SUP@hotel.test', PASS, array( 'remember' => true ) );
		eq( array( SUP_ID, true, true ), $GLOBALS['azl_wp']['cookie'], 'keep me signed in' );
		$r = sign_in( 'phone@hotel.test', PASS, array( 'redirectTo' => 'https://evil.test/helpdesk/' ) );
		eq( DESK, $r->get_data()['redirect'] );
		eq( array( PHONE_ID, true, true ), $GLOBALS['azl_wp']['cookie'], 'a shared phone stays signed in' );
		eq( 'no-store, max-age=0', $r->get_headers()['Cache-Control'] );
	}
);

test(
	'login: unknown account, wrong password, disabled account and no desk access get the identical answer',
	function () {
		cast();
		update_user_meta( SUP_ID, Azl_Auth::DISABLED, 1 );
		$answers = array(
			'unknown'  => sign_in( 'nobody@hotel.test', PASS ),
			'wrong'    => sign_in( 'manager@hotel.test', 'wrong password!' ),
			'disabled' => sign_in( 'sup@hotel.test', PASS ),
			'no desk'  => sign_in( 'guest@hotel.test', PASS ),
		);
		foreach ( $answers as $case => $r ) {
			eq( 401, $r->get_status(), $case );
			eq( array( 'ok' => false, 'error' => 'That email and password do not match.', 'code' => 'azl_failed' ), $r->get_data(), $case );
			eq( $answers['unknown']->get_headers(), $r->get_headers(), "$case headers" );
		}
		eq( null, $GLOBALS['azl_wp']['cookie'], 'no cookie was set' );
	}
);

test(
	'login: 5 failures lock the account on this address for 15 minutes (429 + Retry-After); success resets the count',
	function () {
		cast();
		for ( $i = 0; $i < 4; $i++ ) {
			eq( 401, sign_in( 'manager@hotel.test', 'nope nope nope' )->get_status() );
		}
		eq( 200, sign_in( 'manager@hotel.test', PASS )->get_status(), 'success after 4 failures' );
		for ( $i = 0; $i < 4; $i++ ) {
			eq( 401, sign_in( 'manager@hotel.test', 'nope nope nope' )->get_status(), 'count started again' );
		}
		eq( 401, sign_in( 'manager@hotel.test', 'nope nope nope' )->get_status(), 'fifth failure' );
		$locked = sign_in( 'manager@hotel.test', PASS );
		eq( 429, $locked->get_status(), 'even the right password' );
		eq( 'Too many attempts. Try again in 15 minutes.', $locked->get_data()['error'] );
		eq( '900', $locked->get_headers()['Retry-After'] );
		eq( 200, sign_in( 'sup@hotel.test', PASS )->get_status(), 'other accounts are not locked' );
		$_SERVER['REMOTE_ADDR'] = '198.51.100.9';
		eq( 200, sign_in( 'manager@hotel.test', PASS )->get_status(), 'the pair is account + address' );
		$_SERVER['REMOTE_ADDR'] = '203.0.113.7';
		azl_advance( 14 * 60 * 1000 );
		eq( 'Too many attempts. Try again in 1 minute.', sign_in( 'manager@hotel.test', PASS )->get_data()['error'] );
		azl_advance( 61 * 1000 );
		eq( 200, sign_in( 'manager@hotel.test', PASS )->get_status(), 'lock over' );
	}
);

test(
	'login: 20 failures from one address lock that address for an hour; X-Forwarded-For is ignored unless trusted',
	function () {
		cast();
		for ( $i = 0; $i < 20; $i++ ) {
			$_SERVER['HTTP_X_FORWARDED_FOR'] = "10.0.0.$i"; // spoofed: must not spread the count
			eq( 401, sign_in( "user$i@hotel.test", 'nope nope nope' )->get_status() );
		}
		$r = sign_in( 'sup@hotel.test', PASS );
		eq( 429, $r->get_status() );
		eq( '3600', $r->get_headers()['Retry-After'] );
		eq( 'Too many attempts. Try again in 60 minutes.', $r->get_data()['error'] );
		update_option( 'azl_trust_proxy_headers', true );
		$_SERVER['HTTP_X_FORWARDED_FOR'] = 'spoofed, 192.0.2.44';
		eq( '192.0.2.44', Azl_Auth::client_ip(), 'right-most entry, added by the trusted proxy' );
		eq( 200, Azl_Auth::login( post( array( 'login' => 'sup@hotel.test', 'password' => PASS, 'csrf' => Azl_Auth::csrf_token() ) ) )->get_status() );
	}
);

test(
	'login: missing, forged, expired, other-browser and cross-origin CSRF are refused',
	function () {
		cast();
		$good = Azl_Auth::csrf_token();
		list( $ts, $mac ) = explode( '.', $good );
		$cases = array(
			'missing'   => null,
			'empty'     => '',
			'forged'    => $ts . '.' . str_repeat( 'a', 64 ),
			'retimed'   => ( $ts + 5 ) . '.' . $mac,
			'garbage'   => 'x.y',
		);
		foreach ( $cases as $case => $token ) {
			$r = Azl_Auth::login( post( array( 'login' => 'sup@hotel.test', 'password' => PASS, 'csrf' => $token ) ) );
			eq( 403, $r->get_status(), $case );
			eq( 'azl_csrf', $r->get_data()['code'], $case );
		}
		$_SERVER['HTTP_USER_AGENT'] = 'OtherBrowser/2.0';
		eq( 403, Azl_Auth::login( post( array( 'login' => 'sup@hotel.test', 'password' => PASS, 'csrf' => $good ) ) )->get_status(), 'other browser' );
		$_SERVER['HTTP_USER_AGENT'] = 'TestBrowser/1.0';
		$_SERVER['REMOTE_ADDR']     = '198.51.100.1';
		eq( 403, Azl_Auth::login( post( array( 'login' => 'sup@hotel.test', 'password' => PASS, 'csrf' => $good ) ) )->get_status(), 'other address' );
		$_SERVER['REMOTE_ADDR'] = '203.0.113.7';
		eq( 403, Azl_Auth::login( post( array( 'login' => 'sup@hotel.test', 'password' => PASS, 'csrf' => $good ), array( 'Origin' => 'https://evil.test' ) ) )->get_status(), 'cross-origin' );
		eq( 200, Azl_Auth::login( post( array( 'login' => 'sup@hotel.test', 'password' => PASS, 'csrf' => $good ), array( 'Origin' => 'https://azaleabaguio.test' ) ) )->get_status(), 'same origin' );
		azl_advance( 7201 * 1000 );
		eq( 403, Azl_Auth::login( post( array( 'login' => 'sup@hotel.test', 'password' => PASS, 'csrf' => $good ) ) )->get_status(), 'expired after 2 hours' );
		// CSRF refusals do not count as sign-in failures.
		foreach ( $GLOBALS['azl_wp']['transients'] as $k => $v ) {
			ok( 0 !== strpos( $k, 'azl_rl_' ), "no rate-limit entry: $k" );
		}
	}
);

test(
	'redirect_to: only this site\'s /helpdesk/ pages; every open-redirect trick gives the desk',
	function () {
		$attacks = array(
			'https://evil.test/helpdesk/',
			'https://evil.test/staging2-baguio/helpdesk/requests',
			'http://azaleabaguio.test.evil.test/staging2-baguio/helpdesk/requests',
			'//evil.test/staging2-baguio/helpdesk/',
			'/\\evil.test/helpdesk/',
			'https://azaleabaguio.test.evil.test/staging2-baguio/helpdesk/',
			'https://user@azaleabaguio.test/staging2-baguio/helpdesk/',
			'https://azaleabaguio.test:8443/staging2-baguio/helpdesk/',
			'javascript:alert(1)',
			'/staging2-baguio/wp-admin/',
			'/staging2-baguio/helpdesk/../wp-admin/',
			'/staging2-baguio/helpdesk/%2e%2e/wp-admin/',
			'/staging2-baguio/helpdeskevil/',
			'/helpdesk/',
			"/staging2-baguio/helpdesk/\nLocation: https://evil.test",
			'/staging2-baguio/helpdesk/login/',
			'/staging2-baguio/helpdesk/reset/?key=x',
			'https:evil.test',
			array( 'x' ),
			'',
		);
		foreach ( $attacks as $raw ) {
			eq( DESK, Azl_Auth::safe_redirect( $raw ), 'attack ' . json_encode( $raw ) );
		}
		eq( AZL_TEST_HOME . '/helpdesk/requests?room=401', Azl_Auth::safe_redirect( '/staging2-baguio/helpdesk/requests?room=401' ) );
		eq( AZL_TEST_HOME . '/helpdesk/', Azl_Auth::safe_redirect( AZL_TEST_HOME . '/helpdesk/' ) );
		eq( AZL_TEST_HOME . '/helpdesk', Azl_Auth::safe_redirect( 'HTTPS://AzaleaBaguio.test/staging2-baguio/helpdesk' ) );
	}
);

test(
	'sessions: phones 30 days, people 7 days with "keep me signed in" else 12 hours, administrators untouched',
	function () {
		cast();
		eq( 30 * DAY_IN_SECONDS, Azl_Auth::cookie_expiration( 172800, PHONE_ID, false ) );
		eq( 7 * DAY_IN_SECONDS, Azl_Auth::cookie_expiration( 172800, SUP_ID, true ) );
		eq( 12 * HOUR_IN_SECONDS, Azl_Auth::cookie_expiration( 172800, OWNER_ID, false ) );
		eq( 12 * HOUR_IN_SECONDS, Azl_Auth::cookie_expiration( 172800, MGR_ID, false ) );
		eq( 172800, Azl_Auth::cookie_expiration( 172800, ADMIN_ID, false ) );
		eq( 172800, Azl_Auth::cookie_expiration( 172800, SUB_ID, true ) );
	}
);

test(
	'logout ends the WordPress session and the PIN sign-in, and points to the login page',
	function () {
		cast();
		as_user( PHONE_ID );
		Azl_Auth::register_routes();
		eq( 'is_user_logged_in', $GLOBALS['azl_wp']['routes']['azl-ehd/v1/auth/logout']['permission_callback'] );
		$tok = Azl_Pin::sign_actor( PHONE_ID, MARIA )['token'];
		azl_advance( 1 );
		$r = Azl_Auth::logout( post( array() ) );
		eq( array( 'ok' => true, 'redirect' => AZL_TEST_HOME . '/helpdesk/login/' ), $r->get_data() );
		eq( PHONE_ID, $GLOBALS['azl_wp']['logged_out'] );
		eq( null, Azl_Pin::read_actor( $tok, PHONE_ID ), 'PIN token voided' );
	}
);

/* ---------- forgot and reset ---------- */

test(
	'forgot: always the same answer; a link only for an active desk account; 3 per hour per email and per address',
	function () {
		cast();
		update_user_meta( SUP_ID, Azl_Auth::DISABLED, 1 );
		$ask = function ( string $email ) {
			return Azl_Auth::forgot( post( array( 'email' => $email, 'csrf' => Azl_Auth::csrf_token() ) ) );
		};
		$expect = array( 'ok' => true, 'message' => 'If that email has an account, a link is on its way.' );
		$_SERVER['REMOTE_ADDR'] = '198.51.100.1';
		eq( $expect, $ask( 'manager@hotel.test' )->get_data() );
		$_SERVER['REMOTE_ADDR'] = '198.51.100.2';
		eq( $expect, $ask( 'nobody@hotel.test' )->get_data() );
		$_SERVER['REMOTE_ADDR'] = '198.51.100.3';
		eq( $expect, $ask( 'sup@hotel.test' )->get_data(), 'disabled' );
		$_SERVER['REMOTE_ADDR'] = '198.51.100.4';
		eq( $expect, $ask( 'guest@hotel.test' )->get_data(), 'no desk access' );
		eq( array( 'manager@hotel.test' ), array_column( $GLOBALS['azl_wp']['mails'], 'to' ) );
		ok( false !== strpos( $GLOBALS['azl_wp']['mails'][0]['body'], AZL_TEST_HOME . '/helpdesk/reset/?key=' ), 'desk reset link' );

		$_SERVER['REMOTE_ADDR'] = '198.51.100.5';
		eq( 200, $ask( 'manager@hotel.test' )->get_status() );
		$_SERVER['REMOTE_ADDR'] = '198.51.100.6';
		eq( 200, $ask( 'manager@hotel.test' )->get_status() );
		$_SERVER['REMOTE_ADDR'] = '198.51.100.7';
		$r = $ask( 'manager@hotel.test' );
		eq( 429, $r->get_status(), 'fourth for one email' );
		ok( isset( $r->get_headers()['Retry-After'] ), 'Retry-After' );
		$_SERVER['REMOTE_ADDR'] = '198.51.100.8';
		eq( 200, $ask( 'a@hotel.test' )->get_status() );
		eq( 200, $ask( 'b@hotel.test' )->get_status() );
		eq( 200, $ask( 'c@hotel.test' )->get_status() );
		eq( 429, $ask( 'd@hotel.test' )->get_status(), 'fourth from one address' );
		eq( 403, Azl_Auth::forgot( post( array( 'email' => 'manager@hotel.test', 'csrf' => 'forged' ) ) )->get_status() );
	}
);

test(
	'reset: an invalid key is refused; rules for the new password; success ends sessions and uses the key up',
	function () {
		cast();
		$send = function ( array $b ) {
			return Azl_Auth::reset( post( $b + array( 'csrf' => Azl_Auth::csrf_token() ) ) );
		};
		$r = $send( array( 'login' => 'manager@hotel.test', 'key' => 'abcdefghijklmnopqrst', 'password' => 'a good long password' ) );
		eq( 400, $r->get_status() );
		eq( 'azl_expired', $r->get_data()['code'] );
		eq( null, Azl_Auth::check_key( '<script>', 'manager@hotel.test' ) );
		eq( null, Azl_Auth::check_key( array(), 'manager@hotel.test' ) );

		$key = get_password_reset_key( get_userdata( MGR_ID ) );
		$_SERVER['REMOTE_ADDR'] = '198.51.100.20';
		eq( 'azl_weak', $send( array( 'login' => 'manager@hotel.test', 'key' => $key, 'password' => 'short' ) )->get_data()['code'] );
		eq( 'azl_weak', $send( array( 'login' => 'manager@hotel.test', 'key' => $key, 'password' => 'Manager@Hotel.test' ) )->get_data()['code'] );
		$_SERVER['REMOTE_ADDR'] = '198.51.100.21';
		$ok = $send( array( 'login' => 'manager@hotel.test', 'key' => $key, 'password' => 'a good long password' ) );
		eq( array( 'ok' => true, 'message' => Azl_Auth::SAVED, 'redirect' => AZL_TEST_HOME . '/helpdesk/login/' ), $ok->get_data() );
		eq( array( MGR_ID ), $GLOBALS['azl_wp']['destroyed'] );
		eq( 200, sign_in( 'manager@hotel.test', 'a good long password' )->get_status(), 'new password works' );
		$_SERVER['REMOTE_ADDR'] = '198.51.100.22';
		eq( 'azl_expired', $send( array( 'login' => 'manager@hotel.test', 'key' => $key, 'password' => 'another long password' ) )->get_data()['code'], 'key used up' );
		$key = get_password_reset_key( get_userdata( MGR_ID ) );
		azl_advance( ( DAY_IN_SECONDS + 1 ) * 1000 );
		eq( null, Azl_Auth::check_key( $key, 'manager@hotel.test' ), 'expired key' );
	}
);

/* ---------- headers and pages ---------- */

test(
	'every /helpdesk/ page sends the CSP with a per-request nonce and the other security headers',
	function () {
		$n = Azl_Auth::nonce();
		ok( 1 === preg_match( '/^[A-Za-z0-9_-]{24}$/', $n ), 'nonce shape' );
		ok( Azl_Auth::nonce() !== $n, 'fresh per request' );
		$h   = Azl_Auth::security_headers( $n );
		$csp = array_map( 'trim', explode( ';', $h['Content-Security-Policy'] ) );
		foreach ( array( "default-src 'self'", "script-src 'self' 'nonce-$n'", "style-src 'self' 'nonce-$n'", "font-src 'self'", "img-src 'self' data:", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'" ) as $d ) {
			ok( in_array( $d, $csp, true ), "CSP has $d" );
		}
		ok( false === strpos( $h['Content-Security-Policy'], 'unsafe' ), 'no unsafe-*' );
		has(
			array(
				'X-Content-Type-Options' => 'nosniff',
				'Referrer-Policy'        => 'same-origin',
				'X-Frame-Options'        => 'DENY',
				'Permissions-Policy'     => 'camera=(), microphone=(), geolocation=()',
			),
			$h
		);
		ok( 0 === strpos( $h['Cache-Control'], 'no-store' ), 'no-store' );
		$GLOBALS['azl_wp']['uploads'] = 'https://cdn.azaleabaguio.test/uploads';
		ok( in_array( "img-src 'self' data: https://cdn.azaleabaguio.test", array_map( 'trim', explode( ';', Azl_Auth::security_headers( $n )['Content-Security-Policy'] ) ), true ), 'uploads origin when it is elsewhere' );
	}
);

test(
	'the sign-in pages: labels, autocomplete, live error region, nonce on the token style, light only, no inline script',
	function () {
		cast();
		ob_start();
		Azl_Auth::render( 'login', array( 'nonce' => 'NONCE123', 'redirect' => DESK ) );
		$html = ob_get_clean();
		foreach ( array(
			'<label for="azl-login">',
			'autocomplete="username"',
			'autocomplete="current-password"',
			'autocapitalize="none"',
			'spellcheck="false"',
			'aria-live="polite"',
			'aria-controls="azl-password" aria-pressed="false"',
			'Keep me signed in on this device',
			'Forgot password?',
			'Having trouble? Ask your hotel owner or manager.',
			'<style nonce="NONCE123">',
			'<meta name="color-scheme" content="light">',
			'name="csrf" value="',
			'Service requests, handled.',
			'assets/auth/auth.js',
		) as $needle ) {
			ok( false !== strpos( $html, $needle ), "login page has $needle" );
		}
		ok( false === strpos( $html, 'placeholder=' ), 'labels, not placeholders' );
		ok( false === stripos( $html, 'dark' ), 'no dark mode' );
		ok( 0 === preg_match( '/<script(?![^>]*\bsrc=)/', $html ), 'no inline script' );
		ok( false === strpos( $html, 'wp-admin' ), 'no wp-admin link' );
		ok( false === strpos( $html, 'fonts.googleapis' ) && false === strpos( $html, 'gstatic' ), 'no external fonts' );

		$key = get_password_reset_key( get_userdata( MGR_ID ) );
		ob_start();
		Azl_Auth::render( 'reset', array( 'nonce' => 'N', 'key' => $key, 'login' => 'manager@hotel.test' ) );
		$reset = ob_get_clean();
		eq( 2, substr_count( $reset, 'autocomplete="new-password"' ), 'two new-password fields' );
		ok( false !== strpos( $reset, 'At least 10 characters' ), 'rule shown' );
		ob_start();
		Azl_Auth::render( 'expired', array( 'nonce' => 'N' ) );
		ok( false !== strpos( ob_get_clean(), AZL_TEST_HOME . '/helpdesk/forgot/' ), 'expired page links to a new request' );
	}
);

/* ---------- theme tokens ---------- */

test(
	'theme: both presets carry every variable the desk restyle uses, with the fixed values',
	function () {
		$required = array( '--azl-bg', '--azl-surface', '--azl-ink', '--azl-muted', '--azl-line', '--azl-accent', '--azl-accent-strong', '--azl-accent-soft', '--azl-on-accent', '--azl-deep', '--azl-on-deep', '--azl-gold', '--azl-on-gold', '--azl-ok', '--azl-warn', '--azl-bad', '--azl-ok-soft', '--azl-warn-soft', '--azl-bad-soft', '--azl-font-heading', '--azl-font-body', '--azl-radius-pill', '--azl-radius-card', '--azl-radius-input', '--azl-shadow' );
		foreach ( Azl_Theme::KEYS as $key ) {
			$v = Azl_Theme::vars( $key );
			eq( array(), array_values( array_diff( $required, array_keys( $v ) ) ), "$key is missing nothing" );
			eq( array(), array_values( array_diff( array_keys( $v ), $required ) ), "$key has nothing extra" );
			has( array( '--azl-radius-pill' => '999px', '--azl-radius-card' => '16px', '--azl-radius-input' => '8px', '--azl-on-gold' => '#201e1d' ), $v, $key );
			ok( false === strpos( $v['--azl-shadow'], 'rgba(0, 0, 0' ) && false === strpos( $v['--azl-shadow'], '#000' ), "$key shadow is tinted" );
			ok( 0 === strpos( $v['--azl-font-heading'], '"Amaranth"' ) && false !== strpos( $v['--azl-font-heading'], 'Georgia' ), "$key heading font" );
			ok( 0 === strpos( $v['--azl-font-body'], '"Figtree"' ) && false !== strpos( $v['--azl-font-body'], 'system-ui' ), "$key body font" );
		}
		has( array( '--azl-accent' => '#3f7052', '--azl-accent-strong' => '#345f45', '--azl-deep' => '#142d1f', '--azl-gold' => '#c0a14c', '--azl-bg' => '#f6f2e9' ), Azl_Theme::vars( 'baguio' ) );
		has( array( '--azl-accent' => '#177280', '--azl-accent-strong' => '#135f6b', '--azl-deep' => '#0e393f', '--azl-gold' => '#d8d2c4', '--azl-bg' => '#f7f4ec' ), Azl_Theme::vars( 'boracay' ) );
	}
);

test(
	'theme: WCAG AA contrast (>= 4.5) for every stated text pair on both sites',
	function () {
		eq( 21.0, round( Azl_Theme::contrast( '#000000', '#ffffff' ), 2 ), 'formula' );
		foreach ( Azl_Theme::KEYS as $key ) {
			$v     = Azl_Theme::vars( $key );
			$pairs = array(
				'ink on bg'                => array( '--azl-ink', '--azl-bg' ),
				'ink on surface'           => array( '--azl-ink', '--azl-surface' ),
				'muted on surface'         => array( '--azl-muted', '--azl-surface' ),
				'muted on bg'              => array( '--azl-muted', '--azl-bg' ),
				'on-accent on accent-strong' => array( '--azl-on-accent', '--azl-accent-strong' ),
				'accent-strong on surface' => array( '--azl-accent-strong', '--azl-surface' ),
				'on-gold on gold'          => array( '--azl-on-gold', '--azl-gold' ),
				'on-deep on deep'          => array( '--azl-on-deep', '--azl-deep' ),
				'gold on deep'             => array( '--azl-gold', '--azl-deep' ),
				'ok on ok-soft'            => array( '--azl-ok', '--azl-ok-soft' ),
				'warn on warn-soft'        => array( '--azl-warn', '--azl-warn-soft' ),
				'bad on bad-soft'          => array( '--azl-bad', '--azl-bad-soft' ),
			);
			foreach ( $pairs as $what => list( $fg, $bg ) ) {
				$ratio = Azl_Theme::contrast( $v[ $fg ], $v[ $bg ] );
				ok( $ratio >= 4.5, sprintf( '%s %s is %.2f', $key, $what, $ratio ) );
			}
		}
	}
);

test(
	'theme: the setting picks the preset, else the site address, else Baguio; fonts are local; window.AZL.theme shape',
	function () {
		eq( 'baguio', Azl_Theme::key() );
		$GLOBALS['azl_wp']['home'] = 'https://azaleaboracay.test/staging2';
		eq( 'boracay', Azl_Theme::key() );
		update_option( 'azl_settings', array( 'property_key' => 'baguio' ) );
		eq( 'baguio', Azl_Theme::key(), 'setting wins' );
		update_option( 'azl_settings', array( 'property_key' => 'evil' ) );
		eq( 'boracay', Azl_Theme::key(), 'unknown setting ignored' );
		$GLOBALS['azl_wp']['home'] = 'https://example.test';
		update_option( 'azl_settings', array() );
		eq( 'baguio', Azl_Theme::key(), 'default' );

		$GLOBALS['azl_wp']['home']    = 'https://azaleaboracay.test/staging2';
		$GLOBALS['azl_wp']['logo_id'] = 42;
		$t                            = Azl_Theme::tokens();
		eq( AZL_TEST_HOME . '/wp-content/uploads/logo-42.png', $t['logoUrl'], 'Boracay: the custom logo' );
		$GLOBALS['azl_wp']['logo_id'] = 0;
		eq( $GLOBALS['azl_wp']['icon'], Azl_Theme::tokens()['logoUrl'], 'else the site icon' );
		eq( array( 'key', 'name', 'logoUrl', 'fonts' ), array_keys( Azl_Theme::public_tokens( $t ) ) );
		eq( array( 'heading', 'body' ), array_keys( $t['fonts'] ) );

		$css = Azl_Theme::css( $t );
		ok( 2 === substr_count( $css, '@font-face' ) && 2 === substr_count( $css, 'font-display:swap' ), 'two local font faces' );
		ok( false !== strpos( $css, 'assets/fonts/amaranth-400-latin.woff2' ) && false !== strpos( $css, 'assets/fonts/figtree-variable-latin.woff2' ), 'plugin font files' );
		ok( false !== strpos( $css, ':root{color-scheme:light;--azl-bg:#f7f4ec;' ), 'variables on :root' );
		ok( false === strpos( $css, '<' ), 'cannot close the style tag' );
		foreach ( array( 'amaranth-400-latin.woff2', 'figtree-variable-latin.woff2', 'OFL.txt' ) as $f ) {
			ok( is_readable( AZL_EHD_DIR . 'assets/fonts/' . $f ), "bundled $f" );
		}
		eq( 'wOF2', substr( (string) file_get_contents( AZL_EHD_DIR . 'assets/fonts/amaranth-400-latin.woff2' ), 0, 4 ), 'real woff2' );
	}
);
