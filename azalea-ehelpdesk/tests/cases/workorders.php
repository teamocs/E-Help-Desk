<?php
/**
 * Work Orders (includes/Modules/WorkOrders.php and the built-in assessWo, startWo, holdWo, completeWo, reopenWo):
 * every command, its validation, the transition table, replays, the role matrix, the snapshot fields and the
 * additive upgrade over rows written before wave 2.
 */

/** A reportWo command with valid fields, overridable. */
function wot_report( array $over = array() ): array {
	return $over + array(
		'type'          => 'reportWo',
		'woId'          => id(),
		'area'          => 'Room',
		'loc'           => 'Room 305',
		'desc'          => 'AC compressor not functioning',
		'priority'      => 'high',
		'dept'          => 'engineering',
		'reporterDept'  => 'housekeeping',
		'reporterId'    => JOEL,
		'encodedBy'     => MARIA,
		'requestedDate' => '2027-01-15',
	);
}

/** A reported work order's id. */
function wot_new( array $over = array() ): string {
	$c = wot_report( $over );
	has( array( 'ok' => true, 'applied' => true ), cmd( $c ), 'reportWo' );
	return $c['woId'];
}

function wot_row( string $id ): array {
	return Azl_Db::row( 'SELECT * FROM ' . Azl_Db::t( 'work_orders' ) . ' WHERE id = %s', array( $id ) );
}

function wot_notes( string $id ): array {
	return array_column( Azl_Updates::list( 'work_order', array( $id ) )[ $id ] ?? array(), 'text' );
}

/** The smallest valid command of each type for a work order. */
function wot_cmd( string $type, string $wo ): array {
	$extra = array(
		'openWo'     => array(),
		'assessWo'   => array( 'assessment' => 'Seized compressor', 'assignType' => 'inhouse', 'estCost' => 1500 ),
		'startWo'    => array(),
		'holdWo'     => array( 'reason' => 'Parts on order' ),
		'updateWo'   => array( 'text' => 'Parts ordered' ),
		'completeWo' => array( 'actualCost' => 1400 ),
		'reopenWo'   => array(),
		'editWo'     => array( 'loc' => 'Room ' . wot_room() ),
	)[ $type ];
	return array( 'type' => $type, 'woId' => $wo ) + $extra;
}

function wot_room(): string {
	static $n = 100;
	return (string) ++$n;
}

test(
	'workorders: the transition table, every command from every status (and nothing else moves)',
	function () {
		$table = Azl_Module_WorkOrders::TRANSITIONS;
		$all = Azl_Module_WorkOrders::STATUSES;
		eq(
			array(
				'reportWo'   => array( array(), 'reported' ),
				'openWo'     => array( array( 'scheduled' ), 'reported' ),
				'assessWo'   => array( array( 'reported' ), 'assessed' ),
				'startWo'    => array( array( 'assessed', 'on_hold' ), 'in_progress' ),
				'holdWo'     => array( array( 'in_progress' ), 'on_hold' ),
				'updateWo'   => array( array( 'in_progress', 'on_hold' ), null ),
				'completeWo' => array( array( 'in_progress', 'on_hold', 'assessed' ), 'done' ),
				'reopenWo'   => array( array( 'done' ), 'assessed' ),
				'editWo'     => array( $all, null ),
			),
			$table,
			'the table as specified (docs: WorkOrders.php header)'
		);
		foreach ( array_diff( array_keys( $table ), array( 'reportWo' ) ) as $type ) {
			foreach ( Azl_Module_WorkOrders::STATUSES as $from ) {
				$wo = wot_new();
				Azl_Db::update( 'work_orders', array( 'status' => $from ), array( 'id' => $wo ) );
				$r       = cmd( wot_cmd( $type, $wo ) );
				$allowed = in_array( $from, $table[ $type ][0], true );
				$to      = $table[ $type ][1] ?? $from;
				if ( $allowed ) {
					has( array( 'ok' => true, 'applied' => true ), $r, "$type from $from" );
				} else {
					eq( array( 'ok' => false, 'error' => 'Not possible while the work order is ' . str_replace( '_', ' ', $from ) ), $r, "$type from $from" );
				}
				eq( $allowed ? $to : $from, wot_row( $wo )['status'], "status after $type from $from" );
			}
		}
	}
);

test(
	'workorders: reportWo stores the reporter chain and requested date, numbers it, and refuses bad input before writing',
	function () {
		$c = wot_report();
		eq( array( 'ok' => true, 'applied' => true, 'woNo' => 1 ), cmd( $c ) );
		has(
			array( 'area' => 'Room', 'loc' => 'Room 305', 'priority' => 'high', 'dept' => 'engineering', 'status' => 'reported', 'reported_by' => JOEL, 'encoded_by' => MARIA, 'reporter_dept' => 'housekeeping' ),
			wot_row( $c['woId'] )
		);
		eq( '2027-01-15', Azl_Module_WorkOrders::ms_date( (int) wot_row( $c['woId'] )['requested_date'] ), 'the date in hotel time' );
		eq( array( 'Reported by Joel Dizon (Housekeeping)' ), labels( $c['woId'] ) );
		$before = fingerprint();
		$bad    = array(
			array( array( 'area' => 'Spaceship' ), 'Choose the area.' ),
			array( array( 'desc' => '   ' ), 'Description required.' ),
			array( array( 'priority' => 'normal' ), 'Choose the priority.' ),
			array( array( 'dept' => 'nope' ), 'Choose the department to assign.' ),
			array( array( 'reporterDept' => 'nope' ), "Choose the reporter's department." ),
			array( array( 'reporterId' => RAMON ), 'The reporter is not on the staff of that department.' ),
			array( array( 'encodedBy' => id() ), 'Choose who encoded the work order.' ),
			array( array( 'requestedDate' => '2027-02-30' ), 'Date required.' ),
			array( array( 'requestedDate' => null ), 'Date required.' ),
			array( array( 'schedDate' => 'soon' ), 'The scheduled date is not a valid date.' ),
			array( array( 'loc' => str_repeat( 'x', 81 ) ), 'Keep the location under 80 characters.' ),
			array( array( 'woId' => $c['woId'] ), 'This work order already exists.' ),
		);
		foreach ( $bad as list( $over, $error ) ) {
			eq( array( 'ok' => false, 'error' => $error ), cmd( wot_report( $over ) ), json_encode( $over ) );
		}
		eq( $before, fingerprint(), 'refusals write nothing' );
		eq( 1, Azl_Db::counter( 'wo' ), 'and take no number' );
		// Preventive: a schedule date makes it Scheduled; Open turns it into a reported one.
		$p = wot_new( array( 'schedDate' => '2027-03-01', 'priority' => 'low' ) );
		has( array( 'status' => 'scheduled', 'wo_no' => '2' ), wot_row( $p ) );
		eq( '2027-03-01', Azl_Module_WorkOrders::ms_date( (int) wot_row( $p )['sched_date'] ) );
		eq( array( 'Scheduled for 2027-03-01' ), labels( $p ) );
		has( array( 'ok' => true ), cmd( array( 'type' => 'openWo', 'woId' => $p ) ) );
		eq( 'reported', wot_row( $p )['status'] );
	}
);

test(
	'workorders: every new command is idempotent by op id (a replay changes nothing and answers the same number)',
	function () {
		$c                     = wot_report();
		list( $first, $again ) = twice( $c );
		eq( $first['woNo'], $again['woNo'] );
		$wo = $c['woId'];
		twice( array( 'type' => 'editWo', 'woId' => $wo, 'desc' => 'Compressor seized' ) );
		twice( array( 'type' => 'assessWo', 'woId' => $wo, 'assessment' => 'Replace compressor', 'assignType' => 'inhouse', 'assigneeId' => RAMON, 'targetStart' => '2027-01-10', 'targetEnd' => '2027-01-12' ) );
		twice( array( 'type' => 'startWo', 'woId' => $wo ) );
		twice( array( 'type' => 'updateWo', 'woId' => $wo, 'text' => 'Parts ordered', 'newDeadline' => '2027-01-20', 'extendReason' => 'Parts delayed', 'contractor' => 'CoolAir HVAC', 'estCost' => 15000 ) );
		twice( array( 'type' => 'holdWo', 'woId' => $wo, 'reason' => 'Waiting for the contractor' ) );
		twice( array( 'type' => 'completeWo', 'woId' => $wo, 'actualCost' => 14500, 'notes' => 'Compressor replaced', 'byId' => RAMON ) );
		twice( array( 'type' => 'reopenWo', 'woId' => $wo ) );
		$p = wot_new( array( 'schedDate' => '2027-05-01' ) );
		twice( array( 'type' => 'openWo', 'woId' => $p ) );
		eq( 3, count( wot_notes( $wo ) ), 'one note each for the update, the hold and the completion, none doubled by the replays' );
	}
);

test(
	'workorders: assess, start, hold, resume, complete and reopen keep the new fields (assessor, targets, actual times, hold reason, notes)',
	function () {
		$wo = wot_new();
		eq( array( 'ok' => false, 'error' => 'Assessment required' ), cmd( array( 'type' => 'assessWo', 'woId' => $wo, 'assessment' => ' ', 'assignType' => 'inhouse' ) ) );
		eq( array( 'ok' => false, 'error' => 'The end date is before the start date.' ), cmd( array( 'type' => 'assessWo', 'woId' => $wo, 'assessment' => 'x', 'assignType' => 'inhouse', 'targetStart' => '2027-01-12', 'targetEnd' => '2027-01-10' ) ) );
		eq( array( 'ok' => false, 'error' => 'Choose who is assigned.' ), cmd( array( 'type' => 'assessWo', 'woId' => $wo, 'assessment' => 'x', 'assignType' => 'inhouse', 'assigneeId' => id() ) ) );
		eq( array( 'ok' => false, 'error' => 'Choose who assessed the work.' ), cmd( array( 'type' => 'assessWo', 'woId' => $wo, 'assessment' => 'x', 'assignType' => 'inhouse', 'assessedById' => id() ) ) );
		has( array( 'ok' => true ), cmd( array( 'type' => 'assessWo', 'woId' => $wo, 'assessment' => 'Seized', 'assignType' => 'inhouse', 'assigneeId' => RAMON, 'assessedById' => DENNIS, 'targetStart' => '2027-01-10', 'targetEnd' => '2027-01-12' ) ) );
		$r = wot_row( $wo );
		has( array( 'status' => 'assessed', 'assessment' => 'Seized', 'assignee' => RAMON, 'assessed_by' => DENNIS, 'assessed_at' => (string) Azl_Db::now(), 'est_cost' => null ), $r, 'no estimate is allowed' );
		eq( array( '2027-01-10', '2027-01-12' ), array( Azl_Module_WorkOrders::ms_date( (int) $r['target_start'] ), Azl_Module_WorkOrders::ms_date( (int) $r['target_end'] ) ) );

		$t0 = Azl_Db::now();
		cmd( array( 'type' => 'startWo', 'woId' => $wo ) );
		eq( (string) $t0, wot_row( $wo )['actual_start'] );
		azl_advance( 60000 );
		eq( array( 'ok' => false, 'error' => 'Keep the reason under 255 characters.' ), cmd( array( 'type' => 'holdWo', 'woId' => $wo, 'reason' => str_repeat( 'x', 256 ) ) ) );
		cmd( array( 'type' => 'holdWo', 'woId' => $wo, 'reason' => 'Waiting for parts' ) );
		has( array( 'status' => 'on_hold', 'hold_reason' => 'Waiting for parts' ), wot_row( $wo ) );
		cmd( array( 'type' => 'startWo', 'woId' => $wo ) );
		has( array( 'status' => 'in_progress', 'hold_reason' => null, 'actual_start' => (string) $t0 ), wot_row( $wo ), 'resume keeps the first start' );
		cmd( array( 'type' => 'holdWo', 'woId' => $wo ) );
		eq( null, wot_row( $wo )['hold_reason'], 'an older desk may hold without a reason' );
		eq( array( 'ok' => false, 'error' => 'Choose who completed the work.' ), cmd( array( 'type' => 'completeWo', 'woId' => $wo, 'actualCost' => 1, 'byId' => id() ) ) );
		cmd( array( 'type' => 'completeWo', 'woId' => $wo, 'actualCost' => 1200.5, 'notes' => 'New capacitor fitted', 'byId' => RAMON ) );
		has( array( 'status' => 'done', 'actual_end' => (string) Azl_Db::now(), 'completion_notes' => 'New capacitor fitted' ), wot_row( $wo ) );
		eq( 1200.5, (float) wot_row( $wo )['actual_cost'] );
		eq( RAMON, Azl_Updates::list( 'work_order', array( $wo ) )[ $wo ][1]['by'], 'the note is by the chosen person' );
		eq( array( 'On hold: Waiting for parts', 'Completed: New capacitor fitted' ), wot_notes( $wo ) );
		cmd( array( 'type' => 'reopenWo', 'woId' => $wo ) );
		has( array( 'status' => 'assessed', 'actual_end' => null, 'actual_cost' => null, 'completion_notes' => null ), wot_row( $wo ), 'reopen goes back to assessed, clearing the completion' );
	}
);

test(
	'workorders: updateWo adds one note, extends the deadline from the target or the requested date, and moves the job to a contractor once',
	function () {
		$wo = wot_new();
		cmd( wot_cmd( 'assessWo', $wo ) + array( 'assigneeId' => RAMON ) );
		cmd( array( 'type' => 'startWo', 'woId' => $wo ) );
		$before = fingerprint();
		foreach (
			array(
				array( array( 'text' => '' ), 'Required.' ),
				array( array( 'text' => 'x', 'newDeadline' => 'next week' ), 'New deadline required.' ),
				array( array( 'text' => 'x', 'contractor' => ' ' ), 'Contractor required.' ),
				array( array( 'text' => 'x', 'contractor' => 'A', 'estCost' => -5 ), 'Enter a cost of zero or more' ),
				array( array( 'text' => 'x', 'byId' => id() ), 'Choose who gave the update.' ),
			) as list( $f, $error )
		) {
			eq( array( 'ok' => false, 'error' => $error ), cmd( array( 'type' => 'updateWo', 'woId' => $wo ) + $f ), $error );
		}
		eq( $before, fingerprint(), 'refusals write nothing' );
		has( array( 'ok' => true ), cmd( array( 'type' => 'updateWo', 'woId' => $wo, 'text' => 'Compressor needs a specialist', 'byId' => RAMON, 'newDeadline' => '2027-01-20', 'extendReason' => 'Parts delayed', 'contractor' => 'CoolAir HVAC', 'estCost' => 15000 ) ) );
		has( array( 'assign_type' => 'outsource', 'contractor' => 'CoolAir HVAC', 'assignee' => null ), wot_row( $wo ) );
		eq( 15000.0, (float) wot_row( $wo )['est_cost'] );
		eq( '2027-01-20', Azl_Module_WorkOrders::ms_date( (int) wot_row( $wo )['target_end'] ) );
		eq( array( "Compressor needs a specialist\nDeadline: 2027-01-15 → 2027-01-20 (Parts delayed)\nOutsourced: CoolAir HVAC" ), wot_notes( $wo ), 'from the requested date when no target was set' );
		ok( in_array( 'Deadline extended: 2027-01-15 → 2027-01-20', labels( $wo ), true ) && in_array( 'Outsourced: CoolAir HVAC', labels( $wo ), true ), 'audit lines' );
		eq( array( 'ok' => false, 'error' => 'This work order is already outsourced.' ), cmd( array( 'type' => 'updateWo', 'woId' => $wo, 'text' => 'x', 'contractor' => 'Other' ) ) );
		cmd( array( 'type' => 'updateWo', 'woId' => $wo, 'text' => 'Contractor on site', 'newDeadline' => '2027-01-25' ) );
		eq( "Contractor on site\nDeadline: 2027-01-20 → 2027-01-25", wot_notes( $wo )[1], 'a second extension starts from the extended deadline' );
	}
);

test(
	'workorders: editWo changes only what differs, keeps old priority values, and guards the contractor and assignee',
	function () {
		$wo = wot_new();
		Azl_Db::update( 'work_orders', array( 'priority' => 'normal' ), array( 'id' => $wo ) ); // a row from before wave 2
		eq( array( 'ok' => false, 'error' => 'Nothing to change.' ), cmd( array( 'type' => 'editWo', 'woId' => $wo, 'loc' => 'Room 305', 'area' => 'Room' ) ) );
		eq( array( 'ok' => false, 'error' => 'Choose the priority.' ), cmd( array( 'type' => 'editWo', 'woId' => $wo, 'priority' => 'whenever' ) ) );
		eq( array( 'ok' => false, 'error' => 'Only an outsourced work order has a contractor.' ), cmd( array( 'type' => 'editWo', 'woId' => $wo, 'contractor' => 'X' ) ) );
		eq( array( 'ok' => false, 'error' => 'Unknown work order' ), cmd( array( 'type' => 'editWo', 'woId' => id(), 'loc' => 'x' ) ) );
		has( array( 'ok' => true ), cmd( array( 'type' => 'editWo', 'woId' => $wo, 'loc' => 'Room 306', 'desc' => 'Noisy compressor', 'assigneeId' => RAMON, 'requestedDate' => '2027-02-01' ) ) );
		has( array( 'loc' => 'Room 306', 'descr' => 'Noisy compressor', 'assignee' => RAMON, 'priority' => 'normal' ), wot_row( $wo ), 'priority untouched stays normal' );
		eq( 'Edited: location, description, assigned, requested date', labels( $wo )[1] );
		cmd( array( 'type' => 'editWo', 'woId' => $wo, 'priority' => 'urgent', 'dept' => 'it' ) );
		has( array( 'priority' => 'urgent', 'dept' => 'it' ), wot_row( $wo ) );
		Azl_Db::update( 'work_orders', array( 'assign_type' => 'outsource', 'contractor' => 'A', 'assignee' => null ), array( 'id' => $wo ) );
		eq( array( 'ok' => false, 'error' => 'This work order is outsourced: change the contractor instead.' ), cmd( array( 'type' => 'editWo', 'woId' => $wo, 'assigneeId' => RAMON ) ) );
		cmd( array( 'type' => 'editWo', 'woId' => $wo, 'contractor' => 'CoolAir HVAC' ) );
		Azl_Db::update( 'work_orders', array( 'assign_type' => 'inhouse', 'assignee' => RAMON ), array( 'id' => $wo ) );
		cmd( array( 'type' => 'editWo', 'woId' => $wo, 'clearAssignee' => true ) );
		eq( null, wot_row( $wo )['assignee'], 'clearAssignee removes who is assigned' );
		eq( 'CoolAir HVAC', wot_row( $wo )['contractor'] );
	}
);

test(
	'workorders: completing an escalated work order with notes still closes the source request item',
	function () {
		$it = on_site_ac( '412' );
		$wo = id();
		cmd( array( 'type' => 'escalate', 'itemId' => $it, 'woId' => $wo ) );
		cmd( array( 'type' => 'assessWo', 'woId' => $wo, 'assessment' => 'Fan', 'assignType' => 'outsource', 'contractor' => 'Coolfix' ) );
		cmd( array( 'type' => 'startWo', 'woId' => $wo ) );
		has( array( 'ok' => true ), cmd( array( 'type' => 'completeWo', 'woId' => $wo, 'actualCost' => 900, 'notes' => 'Fan replaced' ) ) );
		eq( 'done', item_row( $it )['status'] );
		ok( in_array( 'Closed by WO-0001', labels( $it ), true ), 'the item names its work order' );
	}
);

test(
	'workorders: the role matrix: the desk and managers act; on a phone repairs staff act, other staff only view; no PIN, nothing',
	function () {
		access_accounts();
		$wo = wot_new();
		$GLOBALS['azl_wp']['user'] = ACC_PHONE;
		has( array( 'ok' => true, 'applied' => true ), cmd( wot_report(), JOEL ), 'housekeeping staff may report one (B.3 "report only")' );
		eq( array( 'ok' => false, 'error' => sprintf( Azl_Access::REPORT_ONLY, 'Work Orders' ) ), cmd( wot_cmd( 'assessWo', $wo ), JOEL ), 'but not act on it' );
		has( array( 'ok' => true ), cmd( wot_cmd( 'assessWo', $wo ), RAMON ), 'engineering handles repairs' );
		has( array( 'ok' => true ), cmd( wot_report(), MARIA ), 'the help desk officer' );
		eq( array( 'ok' => false, 'error' => 'Sign in with your PIN first.' ), cmd( wot_report(), null ) );
		foreach ( array( ACC_SUP, ACC_MANAGER, ACC_OWNER ) as $acc ) {
			$GLOBALS['azl_wp']['user'] = $acc;
			has( array( 'ok' => true ), cmd( wot_report(), null ), "account $acc" );
		}
		$GLOBALS['azl_wp']['user'] = 0;
	}
);

test(
	'workorders: the snapshot carries the new fields and the progress notes; untouched rows leave them out',
	function () {
		$wo = wot_new( array( 'schedDate' => null ) );
		cmd( wot_cmd( 'assessWo', $wo ) + array( 'assigneeId' => RAMON, 'targetEnd' => '2027-01-20' ) );
		cmd( array( 'type' => 'startWo', 'woId' => $wo ) );
		cmd( array( 'type' => 'updateWo', 'woId' => $wo, 'text' => 'Parts ordered' ) );
		$s = json_decode( json_encode( Azl_Snapshot::load( array( 'kind' => 'owner', 'dept' => null ) ) ), true );
		$w = $s['wos'][0];
		has(
			array(
				'no'            => 'WO-0001',
				'priority'      => 'high',
				'reportedBy'    => JOEL,
				'reporterDept'  => 'housekeeping',
				'requestedDate' => Azl_Module_WorkOrders::date_ms( '2027-01-15' ),
				'targetEnd'     => Azl_Module_WorkOrders::date_ms( '2027-01-20' ),
				'assignee'      => RAMON,
				'assessedBy'    => MARIA,
				'assessedAt'    => Azl_Db::now(),
				'actualStart'   => Azl_Db::now(),
			),
			$w
		);
		eq( 1500.0, (float) $w['estCost'] );
		eq( array( array( 'at' => Azl_Db::now(), 'by' => MARIA, 'text' => 'Parts ordered' ) ), $w['updates'] );
		ok( ! array_key_exists( 'holdReason', $w ) && ! array_key_exists( 'schedDate', $w ) && ! array_key_exists( 'actualEnd', $w ), 'empty fields are left out' );
		ok( isset( $s['catalog']['woAreas'] ) && 'Room' === $s['catalog']['woAreas'][0]['label'] && 8 === count( $s['catalog']['woAreas'] ), 'the areas list' );
		eq( array(), $s['modules']['workorders'] ?? null, 'an empty module slice (the desk keeps its optimistic overlay there)' );
	}
);

test(
	'workorders: the additive upgrade: a database with the old tables and rows gains the columns, keeps every value, and the commands work on old rows',
	function () {
		$wo_mod = Azl_Modules::get( 'workorders' );
		$cl_mod = Azl_Modules::get( 'cleaning' );
		Azl_Modules::forget( 'workorders' );
		Azl_Modules::forget( 'cleaning' );
		try {
			// A fresh database as a 0.4.0 site has it: the plugin's own work_orders and clean_tasks, with records.
			$GLOBALS['wpdb'] = new Wpdb_Sqlite();
			Azl_Schema::install();
			seed_staff();
			$cols = static function ( string $t ): array {
				return array_column( $GLOBALS['wpdb']->pdo->query( 'PRAGMA table_info(' . Azl_Db::t( $t ) . ')' )->fetchAll( PDO::FETCH_ASSOC ), 'name' );
			};
			ok( ! in_array( 'requested_date', $cols( 'work_orders' ), true ) && ! in_array( 'clock_in', $cols( 'clean_tasks' ), true ), 'old shape' );
			$old = id();
			Azl_Db::insert( 'work_orders', array( 'id' => $old, 'wo_no' => 7, 'area' => 'Guest room', 'loc' => 'Room 412', 'descr' => 'AC not cold (from T-0001)', 'priority' => 'normal', 'dept' => 'engineering', 'status' => 'reported', 'reported_by' => MARIA, 'encoded_by' => MARIA, 'op_id' => id(), 'created_at' => 1, 'updated_at' => 1 ) );
			$task = clean_task( '903', 'ready' );
			Azl_Db::update( 'clean_tasks', array( 'type' => 'Deep clean' ), array( 'id' => $task ) );
			Azl_Db::update( 'seq', array( 'val' => 7 ), array( 'name' => 'wo' ) );
			$before = array( Azl_Db::rows( 'SELECT * FROM ' . Azl_Db::t( 'work_orders' ) ), Azl_Db::rows( 'SELECT * FROM ' . Azl_Db::t( 'clean_tasks' ) ) );

			Azl_Modules::register( $wo_mod );
			Azl_Modules::register( $cl_mod );
			Azl_Schema::maybe_upgrade();
			ok( in_array( 'requested_date', $cols( 'work_orders' ), true ) && in_array( 'sched_date', $cols( 'work_orders' ), true ) && in_array( 'clock_out', $cols( 'clean_tasks' ), true ) && in_array( 'op_id', $cols( 'clean_tasks' ), true ), 'columns added' );
			$strip = static function ( array $rows, array $keep ): array {
				return array_map(
					static function ( $r ) use ( $keep ) {
						return array_intersect_key( $r, array_flip( $keep ) );
					},
					$rows
				);
			};
			eq( $before[0], $strip( Azl_Db::rows( 'SELECT * FROM ' . Azl_Db::t( 'work_orders' ) ), array_keys( $before[0][0] ) ), 'every old work-order value kept' );
			eq( $before[1], $strip( Azl_Db::rows( 'SELECT * FROM ' . Azl_Db::t( 'clean_tasks' ) ), array_keys( $before[1][0] ) ), 'every old cleaning value kept' );
			eq( null, wot_row( $old )['requested_date'], 'new columns start empty' );

			has( array( 'ok' => true ), cmd( array( 'type' => 'assessWo', 'woId' => $old, 'assessment' => 'Gas top-up', 'assignType' => 'inhouse' ) ) );
			has( array( 'ok' => true ), cmd( array( 'type' => 'startWo', 'woId' => $old ) ) );
			eq( array( 'ok' => true, 'applied' => true, 'woNo' => 8 ), cmd( wot_report() ), 'numbers continue' );
			has( array( 'ok' => true ), cmd( array( 'type' => 'clockIn', 'taskId' => $task, 'attendantId' => JOEL ) ) );
			$s = json_decode( json_encode( Azl_Snapshot::load() ), true );
			$w = array_values( array_filter( $s['wos'], static fn( $x ) => $x['id'] === $old ) )[0];
			has( array( 'priority' => 'normal', 'status' => 'in_progress', 'area' => 'Guest room' ), $w, 'the old priority stays as stored' );
			has( array( 'type' => 'Deep clean', 'status' => 'in_progress', 'clockIn' => Azl_Db::now() ), $s['cleaning'][0], 'the old type label stays as stored' );
		} finally {
			if ( null === Azl_Modules::get( 'workorders' ) ) {
				Azl_Modules::register( $wo_mod );
			}
			if ( null === Azl_Modules::get( 'cleaning' ) ) {
				Azl_Modules::register( $cl_mod );
			}
		}
	}
);

test(
	'workorders: a module may extend a plugin table only by adding lines, and only one module may extend it',
	function () {
		$sql   = Azl_Modules::get( 'workorders' )->schema();
		$probe = static function ( string $s ): ?string {
			return Azl_Modules::schema_problem( $s );
		};
		eq( 'table azl_work_orders belongs to the plugin', $probe( str_replace( 'descr text NOT NULL', 'descr varchar(10) NOT NULL', $sql ) ), 'a changed column' );
		eq( 'table azl_work_orders belongs to the plugin', $probe( str_replace( "  src_item_id char(36) DEFAULT NULL,\n", '', $sql ) ), 'a dropped column' );
		eq( 'table azl_work_orders belongs to the plugin', $probe( $sql ), 'already extended by the Work Orders module' );
		$cl = Azl_Modules::get( 'cleaning' );
		Azl_Modules::forget( 'cleaning' );
		try {
			eq( null, $probe( $cl->schema() ), 'a strict superset is allowed' );
		} finally {
			Azl_Modules::register( $cl );
		}
	}
);
