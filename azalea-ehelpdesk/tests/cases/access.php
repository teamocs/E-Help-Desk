<?php
/**
 * Azl_Access: the role matrix of docs/MODULES-SPEC.md B.3, who an actor is, and the refusal of every command type
 * for every actor kind.
 */

const ACC_OWNER   = 41;
const ACC_MANAGER = 42;
const ACC_SUP     = 43;
const ACC_PHONE   = 44;
const ACC_ADMIN   = 45;
const LIZA        = 'a0a0a0a0-0000-4000-8000-000000000105'; // supervisor, housekeeping (a staff row)

/** The five desk accounts with the real role capabilities, and a supervisor staff row for the shared phone. */
function access_accounts(): void {
	Azl_Caps::install();
	azl_add_user( ACC_OWNER, 'owner@acc.test', array( 'azl_owner' ) );
	azl_add_user( ACC_MANAGER, 'manager@acc.test', array( 'azl_manager' ) );
	azl_add_user( ACC_SUP, 'sup@acc.test', array( 'azl_supervisor' ) );
	azl_add_user( ACC_PHONE, 'phone@acc.test', array( 'azl_device' ) );
	azl_add_user( ACC_ADMIN, 'ocs@acc.test', array( 'administrator' ) );
	$GLOBALS['azl_wp']['caps'][ ACC_ADMIN ] += array_fill_keys( Azl_Caps::all(), true );
	Azl_Db::insert(
		'staff',
		array( 'id' => LIZA, 'name' => 'Liza Abad', 'initials' => 'LA', 'role' => 'supervisor', 'title' => 'HK Supervisor', 'dept' => 'housekeeping', 'on_shift' => 1, 'active' => 1, 'pin_failed' => 0, 'created_at' => 1, 'updated_at' => 1 )
	);
}

/** B.3 as the spec writes it (V = full, R = read, own, - = none), typed again here so the matrix is checked, not copied. */
function b3(): array {
	$v   = array( 'V' => 'full', 'R' => 'read', 'own' => 'own', '-' => 'none' );
	$raw = array(
		'dashboard'   => array( 'V', 'V', 'V', 'V', '-' ),
		'requests'    => array( 'V', 'V', 'V', 'V', 'own' ),
		'inquiries'   => array( 'V', 'V', 'V', 'V', '-' ),
		'cleaning'    => array( 'V', 'V', 'V', 'V', 'own' ),
		'workorders'  => array( 'V', 'V', 'V', 'V', 'own' ),
		'housestatus' => array( 'V', 'V', 'V', 'V', 'R' ),
		'crisis'      => array( 'V', 'V', 'V', 'own', 'own' ),
		'transport'   => array( 'V', 'V', 'V', 'V', 'own' ),
		'reminders'   => array( 'V', 'V', 'V', 'own', '-' ),
		'reports'     => array( 'V', 'V', 'R', '-', '-' ),
		'config'      => array( 'V', 'V', 'R', 'own', 'own' ),
	);
	$out = array();
	foreach ( $raw as $m => $cells ) {
		$out[ $m ] = array_combine( Azl_Access::KINDS, array_map( fn( $c ) => $v[ $c ], $cells ) );
	}
	return $out;
}

test(
	'access: the matrix is B.3 cell for cell, in sidebar order, and the desk copy (src/modules/access.ts) is the same',
	function () {
		eq( b3(), Azl_Access::MATRIX );
		eq( array( 'dashboard', 'requests', 'inquiries', 'cleaning', 'workorders', 'housestatus', 'crisis', 'transport', 'reminders', 'reports', 'config' ), array_keys( Azl_Access::LABELS ) );
		eq( array_keys( Azl_Access::LABELS ), array_keys( Azl_Access::MATRIX ) );
		$ts = (string) file_get_contents( __DIR__ . '/../../../src/modules/access.ts' );
		ok( 1 === preg_match( '/BEGIN MATRIX[^\n]*\n[^=]*=\s*(\{.*?\});\s*\n\/\/ END MATRIX/s', $ts, $m ), 'access.ts has the matrix block' );
		eq( Azl_Access::MATRIX, json_decode( $m[1], true ), 'access.ts MATRIX' );
		ok( 1 === preg_match( '/BEGIN LABELS[^\n]*\n[^=]*=\s*(\{.*?\});\s*\n\/\/ END LABELS/s', $ts, $m ), 'access.ts has the labels block' );
		eq( Azl_Access::LABELS, json_decode( $m[1], true ), 'access.ts LABELS' );
	}
);

test(
	'access: every command type belongs to a module; unknown types are refused as unknown',
	function () {
		eq( array_keys( Azl_Commands::REQUIRED_IDS ), array_keys( array_intersect_key( Azl_Commands::REQUIRED_IDS, Azl_Access::COMMANDS ) ) );
		eq( count( Azl_Commands::REQUIRED_IDS ), count( Azl_Access::COMMANDS ) );
		eq( null, Azl_Access::module_of( 'dropTables' ) );
		eq( 'Unknown command', Azl_Access::refusal( array( 'type' => 'dropTables' ), array( 'kind' => 'owner', 'dept' => null ) ) );
	}
);

test(
	'access: who acts comes from the WordPress role, and on a shared phone from the PIN person\'s job role',
	function () {
		access_accounts();
		eq( array( 'kind' => 'owner', 'dept' => null ), Azl_Access::who( ACC_OWNER, null ) );
		eq( array( 'kind' => 'owner', 'dept' => null ), Azl_Access::who( ACC_ADMIN, null ) );
		eq( array( 'kind' => 'manager', 'dept' => null ), Azl_Access::who( ACC_MANAGER, JOEL ), 'a manager acting with a PIN stays a manager' );
		eq( array( 'kind' => 'supervisor', 'dept' => null ), Azl_Access::who( ACC_SUP, null ) );
		eq( array( 'kind' => 'none', 'dept' => null ), Azl_Access::who( ACC_PHONE, null ), 'shared phone, nobody signed in' );
		eq( array( 'kind' => 'hdo', 'dept' => 'frontdesk' ), Azl_Access::who( ACC_PHONE, MARIA ) );
		eq( array( 'kind' => 'staff', 'dept' => 'housekeeping' ), Azl_Access::who( ACC_PHONE, JOEL ) );
		eq( array( 'kind' => 'supervisor', 'dept' => 'housekeeping' ), Azl_Access::who( ACC_PHONE, LIZA ) );
		Azl_Db::update( 'staff', array( 'active' => 0 ), array( 'id' => JOEL ) );
		eq( 'none', Azl_Access::who( ACC_PHONE, JOEL )['kind'], 'a removed person' );
		eq( 'none', Azl_Access::who( 0, null )['kind'], 'nobody signed in' );
		$GLOBALS['azl_wp']['caps'][77] = array( 'read' => true );
		eq( 'none', Azl_Access::who( 77, null )['kind'], 'an account without the desk' );
	}
);

test(
	'access: department staff\'s "own" is Housekeeping only for Cleaning, and full for repair departments in Work Orders',
	function () {
		$hk  = array( 'kind' => 'staff', 'dept' => 'housekeeping' );
		$eng = array( 'kind' => 'staff', 'dept' => 'engineering' );
		eq( 'full', Azl_Access::level( 'cleaning', $hk ) );
		eq( 'none', Azl_Access::level( 'cleaning', $eng ) );
		eq( 'read', Azl_Access::level( 'workorders', $hk ) );
		eq( 'full', Azl_Access::level( 'workorders', $eng ) );
		eq( 'own', Azl_Access::level( 'requests', $hk ) );
		eq( array( 'requests' => 'own', 'cleaning' => 'full', 'workorders' => 'read', 'housestatus' => 'read', 'crisis' => 'own', 'transport' => 'own', 'config' => 'own' ), Azl_Access::levels( $hk ) );
		eq( array_keys( Azl_Access::LABELS ), array_keys( Azl_Access::levels( array( 'kind' => 'owner', 'dept' => null ) ) ), 'owners see all 11' );
		eq( array_diff( array_keys( Azl_Access::LABELS ), array( 'reports', 'config' ) ), array_keys( array_filter( Azl_Access::levels( array( 'kind' => 'supervisor', 'dept' => null ) ), fn( $l ) => 'full' === $l ) ), 'supervisors change all but Reports and Configuration' );
	}
);

test(
	'access: every command type for every actor kind, through the real command path',
	function () {
		// One open housekeeping item and one engineering item, so item commands can be judged by department.
		list( , $hk ) = logged( '901', array( 'towels' ) );
		list( , $en ) = logged( '902', array( 'ac' ) );
		$kinds = array(
			'owner'      => array( 'kind' => 'owner', 'dept' => null ),
			'manager'    => array( 'kind' => 'manager', 'dept' => null ),
			'supervisor' => array( 'kind' => 'supervisor', 'dept' => null ),
			'hdo'        => array( 'kind' => 'hdo', 'dept' => 'frontdesk' ),
			'staff (HK)' => array( 'kind' => 'staff', 'dept' => 'housekeeping' ),
			'staff (ENG)' => array( 'kind' => 'staff', 'dept' => 'engineering' ),
		);
		$b3    = b3();
		$n     = 0;
		foreach ( Azl_Access::COMMANDS as $type => $module ) {
			foreach ( $kinds as $name => $who ) {
				$level = $b3[ $module ][ $who['kind'] ];
				if ( 'staff' === $who['kind'] && 'cleaning' === $module ) {
					$level = 'housekeeping' === $who['dept'] ? 'full' : 'none';
				}
				if ( 'staff' === $who['kind'] && 'workorders' === $module ) {
					$level = 'engineering' === $who['dept'] ? 'full' : 'read';
				}
				$need    = in_array( $type, array( 'resolveIncident' ), true ) ? 'full' : 'own';
				$allowed = 'full' === $level || ( 'own' === $level && 'own' === $need );
				$own     = 'housekeeping' === $who['dept'] ? $hk[0] : $en[0];
				$other   = 'housekeeping' === $who['dept'] ? $en[0] : $hk[0];
				$cmd     = array( 'type' => $type, 'itemId' => $own );
				eq( $allowed, null === Azl_Access::refusal( $cmd, $who ), "$type for $name ($level)" );
				if ( $allowed && 'own' === $level && in_array( $type, Azl_Access::ITEM_SCOPED, true ) && 'staff' === $who['kind'] ) {
					eq( Azl_Access::OWN, Azl_Access::refusal( array( 'type' => $type, 'itemId' => $other ), $who ), "$type on another department for $name" );
				}
				++$n;
			}
		}
		eq( 22 * 6, $n );
	}
);

test(
	'access: refused commands change nothing and say why; allowed ones run (shared phone, by job role)',
	function () {
		access_accounts();
		list( , $hk ) = logged( '911', array( 'towels' ) );
		list( , $en ) = logged( '912', array( 'ac' ) );
		$GLOBALS['azl_wp']['user'] = ACC_PHONE;
		$before                    = fingerprint();
		eq( array( 'ok' => false, 'error' => 'Your role cannot use Dashboard.' ), cmd( array( 'type' => 'ackHandover', 'handoverId' => id() ), JOEL ) );
		eq( array( 'ok' => false, 'error' => Azl_Access::OWN ), cmd( array( 'type' => 'relay', 'itemId' => $en[0] ), JOEL ) );
		eq( array( 'ok' => false, 'error' => 'Your role cannot use Cleaning.' ), cmd( array( 'type' => 'cleanSet', 'taskId' => clean_task( '913', 'ready' ), 'status' => 'done' ), RAMON ) );
		$before['clean_tasks'] = fingerprint()['clean_tasks']; // the fixture row itself
		eq( $before, fingerprint(), 'nothing written by the refusals' );
		has( array( 'ok' => true, 'applied' => true ), cmd( array( 'type' => 'relay', 'itemId' => $hk[0] ), JOEL ), 'own department' );
		has( array( 'ok' => true, 'applied' => true ), cmd( array( 'type' => 'ackHandover', 'handoverId' => id() ), MARIA ), 'the help-desk officer signs the handover' );
		has( array( 'ok' => true, 'applied' => true ), cmd( array( 'type' => 'relay', 'itemId' => $en[0] ), LIZA ), 'a supervisor on the phone' );
		// The safety alert still starts for anyone who logs a request; only the sign-off needs full access.
		$inc = id();
		has( array( 'ok' => true ), cmd( array( 'type' => 'raiseSafety', 'incidentId' => $inc, 'room' => '914', 'text' => 'smoke', 'hazard' => 'smoke' ), JOEL ) );
		has( array( 'ok' => true ), cmd( array( 'type' => 'record911', 'incidentId' => $inc, 'at' => '2026-10-30T10:00:00Z' ), JOEL ) );
		eq( array( 'ok' => false, 'error' => 'Only a supervisor or manager can do this in Crisis Mgmt.' ), cmd( array( 'type' => 'resolveIncident', 'incidentId' => $inc ), MARIA ) );
		has( array( 'ok' => true ), cmd( array( 'type' => 'resolveIncident', 'incidentId' => $inc ), LIZA ) );
		eq( array( 'ok' => false, 'error' => Azl_Access::NO_PIN ), cmd( array( 'type' => 'relay', 'itemId' => $hk[0] ), null ), 'a phone with nobody signed in' );
	}
);

test(
	'access: a supervisor account reads Reports and Configuration but keeps every desk action it has today; owners and managers keep all',
	function () {
		access_accounts();
		list( , $en ) = logged( '921', array( 'ac' ) );
		foreach ( array( ACC_SUP, ACC_MANAGER, ACC_OWNER, ACC_ADMIN ) as $acc ) {
			$GLOBALS['azl_wp']['user'] = $acc;
			eq( 11, count( Azl_Access::levels( Azl_Access::who( $acc, null ) ) ), "account $acc sees 11 modules" );
		}
		$GLOBALS['azl_wp']['user'] = ACC_SUP;
		has( array( 'ok' => true ), cmd( array( 'type' => 'onSite', 'itemId' => $en[0] ), null ) );
		$wo = id();
		has( array( 'ok' => true ), cmd( array( 'type' => 'escalate', 'itemId' => $en[0], 'woId' => $wo ), null ) );
		has( array( 'ok' => true ), cmd( array( 'type' => 'assessWo', 'woId' => $wo, 'assessment' => 'x', 'assignType' => 'inhouse', 'estCost' => 0 ), null ) );
		has( array( 'ok' => true ), cmd( array( 'type' => 'ackHandover', 'handoverId' => id() ), null ) );
		eq( 'read', Azl_Access::levels( Azl_Access::who( ACC_SUP, null ) )['reports'] );
		eq( 'read', Azl_Access::levels( Azl_Access::who( ACC_SUP, null ) )['config'] );
	}
);

test(
	'access: a refused command over REST (shared phone, PIN token) answers 200 with the reason and keeps nothing',
	function () {
		access_accounts();
		$GLOBALS['azl_wp']['user'] = ACC_PHONE;
		$tok                       = Azl_Pin::sign_actor( ACC_PHONE, JOEL )['token'];
		$r                         = new WP_REST_Request( 'POST' );
		$r->set_header( 'X-Azl-Actor', $tok );
		$r->set_body( json_encode( array( 'type' => 'ackHandover', 'opId' => id(), 'handoverId' => id() ) ) );
		$res = Azl_Rest::command( $r );
		eq( 200, $res->get_status() );
		eq( array( 'ok' => false, 'error' => 'Your role cannot use Dashboard.' ), $res->get_data() );
		eq( 0, (int) Azl_Db::val( 'SELECT COUNT(*) FROM ' . Azl_Db::t( 'handovers' ) ) );
		eq( 0, Azl_Db::counter( 'change' ), 'no poll bump for a refusal' );
	}
);
