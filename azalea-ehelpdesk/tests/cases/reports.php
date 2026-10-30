<?php
/**
 * Reports (includes/Modules/Reports.php): every report's figures on seeded rows, the hotel's calendar days around
 * midnight in Asia/Manila, the previous period, who may read, parameter checks, the CSV export, and that no report
 * ever names a person. The test clock is 2027-01-15 08:00 UTC = 16:00 in Manila.
 */

const RP_OWNER = 40;
const RP_SUP   = 41;

/** Epoch ms of a Manila wall-clock time, 'YYYY-MM-DD HH:MM'. */
function mnl( string $at ): int {
	return 1000 * ( new DateTimeImmutable( $at, new DateTimeZone( 'Asia/Manila' ) ) )->getTimestamp();
}

/** Signs in a desk account of this plugin role (azl_owner, azl_manager, azl_supervisor, azl_device). */
function rp_as( int $user, string $role ): void {
	Azl_Caps::install();
	$GLOBALS['azl_wp']['caps'][ $user ] = $GLOBALS['azl_wp']['roles'][ $role ]->capabilities;
	$GLOBALS['azl_wp']['user']          = $user;
}

/** One request with one item. Times in ms; null leaves the step out. */
function rp_item( string $dept, string $name, int $created, ?int $ack = null, ?int $done = null, int $held = 0, int $sla = 10, string $room = '412' ): string {
	$req = id();
	$it  = id();
	static $n = 0;
	Azl_Db::insert( 'requests', array( 'id' => $req, 'ticket_no' => 9000 + ( ++$n ), 'room' => $room, 'source' => 'guest', 'op_id' => id(), 'created_at' => $created, 'updated_at' => $created, 'logged_by' => MARIA, 'hdo' => MARIA ) );
	Azl_Db::insert(
		'items',
		array(
			'id'         => $it,
			'request_id' => $req,
			'name'       => $name,
			'dept'       => $dept,
			'status'     => null !== $done ? 'done' : ( null !== $ack ? 'relayed' : 'new' ),
			'assignee'   => RAMON,
			'relayed_by' => MARIA,
			'created_at' => $created,
			'updated_at' => $created,
			'ack_at'     => $ack,
			'done_at'    => $done,
			'held_ms'    => $held,
			'sla_min'    => $sla,
		)
	);
	return $it;
}

function rp_get( string $id, array $params = array(), array $headers = array() ): WP_REST_Response {
	$r = request( 'GET', null, $headers, $params + array( 'report' => $id ) );
	return Azl_Module_Reports::get( $r );
}

function rp_data( string $id, array $params = array() ): array {
	$res = rp_get( $id, $params );
	eq( 200, $res->get_status(), "$id status: " . json_encode( $res->get_data() ) );
	return json_decode( json_encode( $res->get_data() ), true );
}

function rp_fig( array $data, string $key ) {
	foreach ( $data['summary'] as $f ) {
		if ( $f['key'] === $key ) {
			return $f['value'];
		}
	}
	throw new Azl_Assert_Failed( "no figure $key" );
}

const RP_DAY = array( 'from' => '2027-01-15', 'to' => '2027-01-15' );

test(
	'reports: Response Time measures the two clocks by department and by request type, hold removed, per item target',
	function () {
		$t = mnl( '2027-01-15 09:00' );
		rp_item( 'housekeeping', 'Extra towels', $t, $t + 60000, $t + 60000 + 5 * 60000, 0, 10 );          // relay 1 min, work 5 of 10
		rp_item( 'housekeeping', 'Extra towels', $t, $t + 180000, $t + 180000 + 14 * 60000, 6 * 60000, 10 ); // relay 3 min, work 14 - 6 held = 8
		rp_item( 'engineering', 'AC not cooling', $t, $t + 90000, $t + 90000 + 50 * 60000, 0, 45 );       // relay 1.5, work 50 of 45: late
		rp_item( 'engineering', 'AC not cooling', $t, null, null, 0, 45 );                                // not acknowledged yet
		$d = rp_data( 'response', RP_DAY );
		eq( 4, rp_fig( $d, 'items' ) );
		eq( 67, rp_fig( $d, 'relayPct' ), '2 of 3 acknowledged within 2 minutes' );
		eq( 1.8, rp_fig( $d, 'relayAvg' ), '(1 + 3 + 1.5) / 3 minutes' );
		eq( 67, rp_fig( $d, 'withinPct' ), 'the held 6 minutes do not count' );
		eq( 21, rp_fig( $d, 'workAvg' ), '(5 + 8 + 50) / 3 minutes' );
		$hk = $d['byDept'][1];
		has( array( 'dept' => 'housekeeping', 'label' => 'Housekeeping', 'items' => 2, 'relayPct' => 50, 'withinPct' => 100, 'workAvg' => 6.5 ), $hk );
		has( array( 'type' => 'AC not cooling', 'dept' => 'Engineering', 'items' => 2, 'withinPct' => 0, 'target' => 45 ), $d['table']['rows'][0] );
		eq( array( 1, 1, 1, 0, 0 ), array_column( $d['relayDist'], 'count' ), 'relay distribution' );
		eq( array( 1, 1, 1, 0 ), array_column( $d['workDist'], 'count' ), 'completion against target' );
		// Filters.
		$e = rp_data( 'response', RP_DAY + array( 'dept' => 'engineering' ) );
		eq( 2, rp_fig( $e, 'items' ) );
		$x = rp_data( 'response', RP_DAY + array( 'type' => 'Extra towels' ) );
		eq( 2, rp_fig( $x, 'items' ) );
		eq( 50, rp_fig( $x, 'relayPct' ) );
	}
);

test(
	'reports: a day is the hotel\'s calendar day in Manila, never the UTC date (midnight boundaries)',
	function () {
		rp_item( 'housekeeping', 'Towels', mnl( '2027-01-14 23:59' ) );  // 15:59 UTC on the 14th: the 14th in Manila
		rp_item( 'housekeeping', 'Towels', mnl( '2027-01-15 00:00' ) );  // 16:00 UTC on the 14th: already the 15th in Manila
		rp_item( 'housekeeping', 'Towels', mnl( '2027-01-15 07:59' ) );  // 23:59 UTC on the 14th
		rp_item( 'housekeeping', 'Towels', mnl( '2027-01-16 00:00' ) );  // the next day
		eq( 2, rp_fig( rp_data( 'response', RP_DAY ), 'items' ), 'the 15th holds 00:00 and 07:59 Manila' );
		eq( 1, rp_fig( rp_data( 'response', array( 'from' => '2027-01-14', 'to' => '2027-01-14' ) ), 'items' ) );
		$k = rp_data( 'kpi', array( 'from' => '2027-01-14', 'to' => '2027-01-16' ) );
		eq( array( array( 'date' => '2027-01-14', 'count' => 1 ), array( 'date' => '2027-01-15', 'count' => 2 ), array( 'date' => '2027-01-16', 'count' => 1 ) ), $k['trend'], 'per-day buckets are Manila days' );
		// Inquiries per hour: 00:30 Manila is hour 0, though it is 16:30 UTC.
		Azl_Db::insert( 'inquiries', array( 'id' => id(), 'inq_no' => 1, 'contact_name' => 'Mr. Santos', 'contact_type' => 'in_house', 'descr' => 'x', 'op_id' => id(), 'created_at' => mnl( '2027-01-15 00:30' ), 'updated_at' => 1 ) );
		$i = rp_data( 'inquiries', RP_DAY );
		eq( 1, $i['byHour'][0]['count'], 'hour 0 in Manila' );
		eq( 0, $i['byHour'][16]['count'] );
		eq( '2027-01-15', $i['table']['rows'][0]['date'] );
	}
);

test(
	'reports: KPI Dashboard compares the range with the previous period of the same length',
	function () {
		// This period: 2027-01-08 to 01-14 (7 days); previous: 01-01 to 01-07.
		foreach ( array( '2027-01-08 10:00', '2027-01-10 10:00', '2027-01-14 23:30' ) as $at ) {
			$t = mnl( $at );
			rp_item( 'housekeeping', 'Towels', $t, $t + 60000, $t + 4 * 60000 );
		}
		$p = mnl( '2027-01-07 23:30' );
		rp_item( 'housekeeping', 'Towels', $p, $p + 300000, $p + 300000 + 20 * 60000 ); // late on both clocks
		rp_item( 'housekeeping', 'Towels', mnl( '2026-12-31 23:59' ) );                     // before the previous period
		$k   = rp_data( 'kpi', array( 'from' => '2027-01-08', 'to' => '2027-01-14' ) );
		$row = array_column( $k['table']['rows'], null, 'label' );
		has( array( 'value' => 3, 'prev' => 1, 'change' => 2, 'unit' => 'count' ), $row['Items logged'] );
		has( array( 'value' => 100, 'prev' => 0, 'change' => 100, 'unit' => 'pct' ), $row['Completed within target'] );
		eq( array( 'from' => '2027-01-01', 'to' => '2027-01-07' ), $k['previous'] );
		eq( 7, count( $k['trend'] ) );
	}
);

test(
	'reports: Room Turnaround runs from the checkout (the checkout rule\'s item) to the clean room, by cleaning type',
	function () {
		$out = mnl( '2027-01-15 10:00' );
		rp_item( 'frontdesk', 'Checkout', $out - 600000, $out - 300000, $out, 0, 10, '305' );
		Azl_Db::insert( 'clean_tasks', array( 'id' => id(), 'room' => '305', 'type' => 'checkout', 'status' => 'done', 'assignee' => JOEL, 'created_at' => $out, 'updated_at' => $out, 'clock_in' => $out + 30 * 60000, 'clock_out' => $out + 70 * 60000 ) );
		// A stay-over clean: no checkout to match.
		Azl_Db::insert( 'clean_tasks', array( 'id' => id(), 'room' => '218', 'type' => 'regular', 'status' => 'done', 'assignee' => JOEL, 'created_at' => $out, 'updated_at' => $out, 'clock_in' => $out, 'clock_out' => $out + 20 * 60000 ) );
		// Still cleaning: not counted.
		Azl_Db::insert( 'clean_tasks', array( 'id' => id(), 'room' => '611', 'type' => 'checkout', 'status' => 'in_progress', 'created_at' => $out, 'updated_at' => $out, 'clock_in' => $out ) );
		$d = rp_data( 'turnaround', RP_DAY );
		eq( 2, rp_fig( $d, 'rooms' ) );
		eq( 30, rp_fig( $d, 'cleanAvg' ), '(40 + 20) / 2 minutes' );
		eq( 1, rp_fig( $d, 'turned' ) );
		eq( 70, rp_fig( $d, 'turnAvg' ), 'checkout 10:00 to clean 11:10' );
		eq( array( 0, 1, 0, 0 ), array_column( $d['turnDist'], 'count' ) );
		has( array( 'type' => 'Checkout', 'rooms' => 1, 'cleanAvg' => 40, 'turnAvg' => 70 ), $d['table']['rows'][0] );
		eq( 1, rp_fig( rp_data( 'turnaround', RP_DAY + array( 'type' => 'regular' ) ), 'rooms' ), 'type filter' );
	}
);

test(
	'reports: WO Summary counts by status and priority (normal reads as medium), overdue by hotel day, time and cost',
	function () {
		$wo = static function ( int $no, string $status, string $pri, int $created, array $x = array() ): void {
			Azl_Db::insert( 'work_orders', $x + array( 'id' => id(), 'wo_no' => $no, 'area' => 'Room', 'loc' => 'Room 305', 'descr' => 'Leak', 'priority' => $pri, 'dept' => 'engineering', 'status' => $status, 'reported_by' => RAMON, 'op_id' => id(), 'created_at' => $created, 'updated_at' => $created ) );
		};
		$t = mnl( '2027-01-15 08:00' );
		$wo( 1, 'done', 'high', $t, array( 'actual_end' => $t + 4 * 3600000, 'est_cost' => '1000.00', 'actual_cost' => '1250.50' ) );
		$wo( 2, 'in_progress', 'normal', $t, array( 'target_end' => mnl( '2027-01-14 00:00' ), 'est_cost' => '500.00' ) ); // deadline yesterday: overdue
		$wo( 3, 'reported', 'urgent', $t, array( 'requested_date' => mnl( '2027-01-15 00:00' ) ) );                       // due today: not overdue
		$wo( 4, 'scheduled', 'low', $t, array( 'sched_date' => mnl( '2027-01-01 00:00' ), 'requested_date' => mnl( '2027-01-01 00:00' ) ) );
		$d = rp_data( 'workorders', RP_DAY );
		eq( 4, rp_fig( $d, 'count' ) );
		eq( 3, rp_fig( $d, 'open' ) );
		eq( 1, rp_fig( $d, 'overdue' ) );
		eq( 4, rp_fig( $d, 'completeAvg' ) );
		eq( 1500, rp_fig( $d, 'est' ) );
		eq( 1250.5, rp_fig( $d, 'actual' ) );
		eq( array( 1, 1, 0, 1, 0, 1 ), array_column( $d['byStatus'], 'count' ), 'scheduled, reported, assessed, in progress, on hold, done' );
		eq( array( 1, 1, 1, 1 ), array_column( $d['byPriority'], 'count' ), 'low, medium (was normal), high, urgent' );
		has( array( 'no' => 'WO-0002', 'priority' => 'Medium', 'overdue' => 'Yes' ), array_column( $d['table']['rows'], null, 'no' )['WO-0002'] );
		eq( 1, rp_fig( rp_data( 'workorders', RP_DAY + array( 'priority' => 'medium' ) ), 'count' ), 'priority filter' );
		eq( 1, rp_fig( rp_data( 'workorders', RP_DAY + array( 'status' => 'done' ) ), 'count' ), 'status filter' );
	}
);

test(
	'reports: Inquiry Volume counts per day, per hour and by contact type, with the quick-close rate',
	function () {
		$inq = static function ( int $no, string $type, string $at, ?int $closed_after = null ): void {
			$c = mnl( $at );
			Azl_Db::insert( 'inquiries', array( 'id' => id(), 'inq_no' => $no, 'contact_name' => 'Guest ' . $no, 'contact_type' => $type, 'descr' => 'x', 'hdo' => MARIA, 'status' => null === $closed_after ? 'active' : 'done', 'closed_at' => null === $closed_after ? null : $c + $closed_after, 'quick_close' => null !== $closed_after && $closed_after <= 360000 ? 1 : 0, 'op_id' => id(), 'created_at' => $c, 'updated_at' => $c ) );
		};
		$inq( 1, 'in_house', '2027-01-15 09:10', 120000 );
		$inq( 2, 'external', '2027-01-15 09:40', 900000 );
		$inq( 3, 'in_house', '2027-01-14 21:00' );
		$d = rp_data( 'inquiries', array( 'from' => '2027-01-14', 'to' => '2027-01-15' ) );
		eq( 3, rp_fig( $d, 'count' ) );
		eq( 1.5, rp_fig( $d, 'perDay' ) );
		eq( 50, rp_fig( $d, 'quickPct' ) );
		eq( 8.5, rp_fig( $d, 'closeAvg' ), '(2 + 15) / 2 minutes' );
		eq( 2, $d['byHour'][9]['count'] );
		eq( 1, $d['byHour'][21]['count'] );
		eq( array( 2, 1, 0 ), array_column( $d['byContact'], 'count' ) );
		has( array( 'date' => '2027-01-15', 'total' => 2, 'inHouse' => 1, 'external' => 1, 'closed' => 2, 'quickPct' => 50 ), $d['table']['rows'][1] );
		eq( 2, rp_fig( rp_data( 'inquiries', array( 'from' => '2027-01-14', 'to' => '2027-01-15', 'contact' => 'in_house' ) ), 'count' ) );
	}
);

test(
	'reports: Crisis Log groups by code, category and place and lists case numbers, codes, times and status only',
	function () {
		$cr = static function ( int $no, ?string $code, ?string $cat, ?string $loc, string $at, ?int $closed_after = null ): void {
			$o = mnl( $at );
			Azl_Db::insert( 'crisis_cases', array( 'id' => id(), 'cr_no' => $no, 'code' => $code, 'comp_cat' => $cat, 'location' => $loc, 'place' => '1208', 'reported_by' => 'Juan Dela Cruz', 'who_type' => 'in_house_guest', 'who' => 'Mrs. Imelda Reyes', 'what' => 'Fainted at the pool', 'status' => null === $closed_after ? 'active' : 'resolved', 'resolved_at' => null === $closed_after ? null : $o + $closed_after, 'logged_by' => MARIA, 'op_id' => id(), 'occurred_at' => $o, 'created_at' => $o, 'updated_at' => $o ) );
		};
		$cr( 1, 'medical_emergency', null, 'pool_area', '2027-01-15 10:00', 2 * 3600000 );
		$cr( 2, 'guest_complaint', 'noise', 'room', '2027-01-15 11:00' );
		$cr( 3, 'medical_emergency', null, 'lobby', '2027-01-15 12:00', 3600000 );
		$d = rp_data( 'crisis', RP_DAY );
		eq( 3, rp_fig( $d, 'count' ) );
		eq( 1, rp_fig( $d, 'open' ) );
		eq( 1.5, rp_fig( $d, 'closeAvg' ) );
		eq( array( 'label' => '10-9 Medical Emergency', 'count' => 2 ), $d['byCode'][0] );
		ok( in_array( array( 'label' => 'Noise', 'count' => 1 ), $d['byCategory'], true ), 'category' );
		eq( array( 'no', 'code', 'category', 'location', 'occurred', 'closed', 'hours', 'called', 'status' ), array_keys( $d['table']['rows'][0] ), 'no who, what, place or reporter' );
		has( array( 'no' => 'CR-0003', 'code' => '10-9 Medical Emergency', 'location' => 'Lobby', 'hours' => 1, 'status' => 'Closed' ), $d['table']['rows'][0] );
		eq( 2, rp_fig( rp_data( 'crisis', RP_DAY + array( 'code' => 'medical_emergency' ) ), 'count' ) );
		eq( 1, rp_fig( rp_data( 'crisis', RP_DAY + array( 'status' => 'active' ) ), 'count' ) );
	}
);

test(
	'reports: no report and no export ever carries a person: no staff name or id, no guest or involved name, no free text',
	function () {
		$t = mnl( '2027-01-15 09:00' );
		rp_item( 'housekeeping', 'Towels', $t, $t + 60000, $t + 120000 );
		Azl_Db::insert( 'inquiries', array( 'id' => id(), 'inq_no' => 1, 'contact_name' => 'Mrs. Imelda Reyes', 'contact_type' => 'external', 'descr' => 'Secret wedding plans', 'hdo' => MARIA, 'op_id' => id(), 'created_at' => $t, 'updated_at' => $t ) );
		Azl_Db::insert( 'crisis_cases', array( 'id' => id(), 'cr_no' => 1, 'code' => 'medical_emergency', 'reported_by' => 'Juan Dela Cruz', 'who' => 'Mrs. Imelda Reyes', 'what' => 'Fainted at the pool', 'place' => 'Cabana 4', 'logged_by' => MARIA, 'op_id' => id(), 'occurred_at' => $t, 'created_at' => $t, 'updated_at' => $t ) );
		Azl_Db::insert( 'work_orders', array( 'id' => id(), 'wo_no' => 1, 'area' => 'Room', 'loc' => 'Room 305', 'descr' => 'Leak by Ramon', 'dept' => 'engineering', 'reported_by' => RAMON, 'encoded_by' => MARIA, 'assignee' => RAMON, 'op_id' => id(), 'created_at' => $t, 'updated_at' => $t ) );
		Azl_Db::insert( 'clean_tasks', array( 'id' => id(), 'room' => '305', 'type' => 'checkout', 'status' => 'done', 'assignee' => JOEL, 'created_at' => $t, 'updated_at' => $t, 'clock_in' => $t, 'clock_out' => $t + 1800000 ) );
		$people = array( 'Maria', 'Santos', 'Joel', 'Dizon', 'Ramon', 'Cruz', 'Dennis', MARIA, JOEL, RAMON, 'Imelda', 'Juan', 'Fainted', 'Cabana', 'Secret', 'Leak' );
		foreach ( Azl_Module_Reports::IDS as $id ) {
			$res  = rp_get( $id, RP_DAY );
			$json = json_encode( $res->get_data(), JSON_UNESCAPED_UNICODE );
			$csv  = 'overview' === $id ? '' : rp_get( $id, RP_DAY + array( 'format' => 'csv' ) )->get_data();
			foreach ( $people as $p ) {
				ok( false === stripos( $json, $p ) && false === stripos( $csv, $p ), "$id must not carry '$p'" );
			}
		}
	}
);

test(
	'reports: owner and manager read every report, a supervisor reads them, a shared phone and other accounts are refused',
	function () {
		$r = request( 'GET', null, array(), array( 'report' => 'kpi' ) );
		rp_as( RP_OWNER, 'azl_owner' );
		ok( Azl_Module_Reports::can_read( $r ), 'owner' );
		rp_as( MANAGER, 'azl_manager' );
		ok( Azl_Module_Reports::can_read( $r ), 'manager' );
		rp_as( RP_SUP, 'azl_supervisor' );
		ok( Azl_Module_Reports::can_read( $r ), 'supervisor (read only)' );
		rp_as( DEVICE, 'azl_device' );
		ok( ! Azl_Module_Reports::can_read( $r ), 'shared phone with nobody signed in' );
		$hdo = Azl_Pin::sign_actor( DEVICE, MARIA )['token'];
		ok( ! Azl_Module_Reports::can_read( request( 'GET', null, array( 'X-Azl-Actor' => $hdo ), array( 'report' => 'kpi' ) ) ), 'shared phone, help-desk officer' );
		$staff = Azl_Pin::sign_actor( DEVICE, RAMON )['token'];
		ok( ! Azl_Module_Reports::can_read( request( 'GET', null, array( 'X-Azl-Actor' => $staff ), array( 'report' => 'kpi' ) ) ), 'shared phone, department staff' );
		ok( ! Azl_Module_Reports::can_read( request( 'GET', null, array( 'X-Azl-Actor' => 'forged.token' ), array( 'report' => 'kpi' ) ) ), 'forged token' );
		Azl_Db::exec( 'UPDATE ' . Azl_Db::t( 'staff' ) . " SET role = 'supervisor' WHERE id = %s", array( JOEL ) );
		$sup = Azl_Pin::sign_actor( DEVICE, JOEL )['token'];
		ok( Azl_Module_Reports::can_read( request( 'GET', null, array( 'X-Azl-Actor' => $sup ), array( 'report' => 'kpi' ) ) ), 'shared phone, a supervisor PIN reads' );
		$GLOBALS['azl_wp']['caps'][ NOBODY ] = array( 'read' => true );
		$GLOBALS['azl_wp']['user']           = NOBODY;
		ok( ! Azl_Module_Reports::can_read( $r ), 'a subscriber' );
		$GLOBALS['azl_wp']['user'] = 0;
		ok( ! Azl_Module_Reports::can_read( $r ), 'signed out' );
		// The route uses this check.
		Azl_Module_Reports::register_routes();
		$route = $GLOBALS['azl_wp']['routes']['azl-ehd/v1/reports/(?P<report>overview|response|kpi|turnaround|workorders|inquiries|crisis)'];
		eq( array( Azl_Module_Reports::class, 'can_read' ), $route['permission_callback'] );
		eq( 'GET', $route['methods'] );
	}
);

test(
	'reports: dates and filters are checked; at most 366 days; defaults to the last 7 hotel days; no-store',
	function () {
		$bad = array(
			array( array( 'from' => '2027-02-30' ), 'Choose real dates (YYYY-MM-DD).' ),
			array( array( 'from' => '15/01/2027' ), 'Choose real dates (YYYY-MM-DD).' ),
			array( array( 'from' => "2027-01-01' OR 1=1" ), 'Choose real dates (YYYY-MM-DD).' ),
			array( array( 'from' => '2027-01-16', 'to' => '2027-01-15' ), 'The start date is after the end date.' ),
			array( array( 'from' => '2026-01-14', 'to' => '2027-01-15' ), 'Choose at most 366 days.' ),
			array( array( 'dept' => "x' OR '1" ), 'That dept filter is not valid.' ),
			array( array( 'priority' => 'normal' ), 'That priority filter is not valid.' ),
			array( array( 'status' => 'lost' ), 'That status filter is not valid.' ),
			array( array( 'format' => 'xlsx' ), 'Unknown format.' ),
			array( array( 'type' => str_repeat( 'x', 121 ) ), 'That request type filter is not valid.' ),
		);
		foreach ( $bad as list( $p, $msg ) ) {
			$res = rp_get( 'workorders', $p );
			eq( 400, $res->get_status(), json_encode( $p ) );
			eq( array( 'ok' => false, 'code' => 'azl_invalid', 'error' => $msg ), $res->get_data() );
		}
		eq( 404, rp_get( 'payroll' )->get_status(), 'unknown report' );
		eq( 200, rp_get( 'kpi', array( 'from' => '2026-01-15', 'to' => '2027-01-15' ) )->get_status(), '366 days is fine' );
		$d = rp_get( 'kpi' );
		eq( array( 'from' => '2027-01-09', 'to' => '2027-01-15', 'days' => 7 ), $d->get_data()['range'] );
		eq( 'no-store, max-age=0', $d->get_headers()['Cache-Control'] );
		// Just after midnight in Manila (still the 14th in UTC), "today" is already the 15th.
		Azl_Db::$clock = mnl( '2027-01-15 00:05' );
		eq( '2027-01-15', rp_get( 'kpi' )->get_data()['range']['to'] );
		eq( array( 'ok' => false, 'code' => 'azl_invalid', 'error' => 'Open a report to export it.' ), rp_get( 'overview', array( 'format' => 'csv' ) )->get_data() );
	}
);

test(
	'reports: the CSV export has a BOM, units in the headings, quoted text, no formulas, and a file name with hotel and range',
	function () {
		$t = mnl( '2027-01-15 09:00' );
		rp_item( 'housekeeping', '=HYPERLINK("http://x","Towels")', $t, $t + 60000, $t + 120000 );
		rp_item( 'housekeeping', '+1 pillow, "soft"', $t );
		rp_item( 'housekeeping', '@SUM(A1)', $t );
		rp_item( 'housekeeping', '-2 hangers', $t );
		rp_item( 'housekeeping', 'Café crème', $t );
		update_option( 'azl_settings', array( 'property_name' => 'Azalea Baguio' ) );
		$res = rp_get( 'response', RP_DAY + array( 'format' => 'csv' ) );
		eq( 200, $res->get_status() );
		$csv = $res->get_data();
		eq( "\xEF\xBB\xBF", substr( $csv, 0, 3 ), 'UTF-8 BOM' );
		$lines = explode( "\r\n", substr( $csv, 3 ) );
		eq( 'Request type,Department,Items,Avg to relay (min),Relayed within 2 min (%),Avg to complete (min),Target (min),Within target (%)', $lines[0] );
		ok( false !== strpos( $csv, "\"'=HYPERLINK(\"\"http://x\"\",\"\"Towels\"\")\",Housekeeping,1,1,100,1,10,100" ), 'formula neutralised and quoted: ' . $csv );
		ok( false !== strpos( $csv, "\"'+1 pillow, \"\"soft\"\"\"" ), 'plus sign' );
		ok( false !== strpos( $csv, "'@SUM(A1)" ), 'at sign' );
		ok( false !== strpos( $csv, "'-2 hangers" ), 'minus sign' );
		ok( false !== strpos( $csv, 'Café crème' ), 'accents kept as UTF-8' );
		eq( '-3', Azl_Module_Reports::cell( -3 ), 'a negative number stays a number' );
		eq( "'\tx", Azl_Module_Reports::cell( "\tx" ) );
		has( array( 'Content-Type' => 'text/csv; charset=utf-8', 'Content-Disposition' => 'attachment; filename="azalea-baguio-response-time-2027-01-15-to-2027-01-15.csv"', 'Cache-Control' => 'no-store, max-age=0' ), $res->get_headers() );
		// WordPress would JSON-encode the string: the filter writes it raw, and only for a CSV response.
		ob_start();
		$served = Azl_Module_Reports::serve_csv( false, $res, null, null );
		eq( $csv, ob_get_clean() );
		ok( true === $served, 'served' );
		ob_start();
		eq( false, Azl_Module_Reports::serve_csv( false, rp_get( 'response', RP_DAY ), null, null ) );
		eq( '', ob_get_clean(), 'JSON stays with WordPress' );
		// Crisis times are hotel time.
		Azl_Db::insert( 'crisis_cases', array( 'id' => id(), 'cr_no' => 7, 'code' => 'fire', 'op_id' => id(), 'occurred_at' => mnl( '2027-01-15 00:30' ), 'created_at' => $t, 'updated_at' => $t ) );
		ok( false !== strpos( rp_get( 'crisis', RP_DAY + array( 'format' => 'csv' ) )->get_data(), 'CR-0007,10-1 Fire,—,—,2027-01-15 00:30,' ), 'Manila time in the export' );
	}
);

test(
	'reports: the overview gives one headline per tile; an empty hotel reports empty, not an error',
	function () {
		$d = rp_data( 'overview' );
		eq( array( 'response', 'kpi', 'turnaround', 'workorders', 'inquiries', 'crisis' ), array_keys( $d['headlines'] ) );
		eq( array( 'key' => 'withinPct', 'label' => 'finished within target', 'value' => null, 'unit' => 'pct' ), $d['headlines']['response'] );
		foreach ( array_slice( Azl_Module_Reports::IDS, 1 ) as $id ) {
			ok( true === rp_data( $id )['empty'], "$id empty" );
		}
	}
);
