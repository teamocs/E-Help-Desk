<?php
/**
 * Cleaning (includes/Modules/Cleaning.php and the built-in cleanSet): log, schedule, clock in and out, edit; the
 * transition table, validation, replays, the role matrix, the cleaningTypes list and the snapshot fields.
 */

function clt_row( string $id ): array {
	return Azl_Db::row( 'SELECT * FROM ' . Azl_Db::t( 'clean_tasks' ) . ' WHERE id = %s', array( $id ) );
}

function clt_log( array $over = array() ): array {
	return $over + array( 'type' => 'logClean', 'taskId' => id(), 'room' => '201', 'cleanType' => 'regular', 'attendantId' => JOEL, 'role' => 'lead', 'clockIn' => true );
}

test(
	'cleaning: cleaningTypes is an editable list seeded with the prototype labels',
	function () {
		eq(
			array( 'regular' => 'Regular', 'checkout' => 'Checkout', 'deep_clean' => 'Deep Clean', 'touch_up' => 'Touch-up', 'pre_arrival' => 'Pre-arrival', 'vip_setup' => 'VIP Setup', 'turndown' => 'Turndown' ),
			array_column( Azl_Catalog::get()['cleaningTypes'], 'label', 'key' )
		);
		ok( in_array( 'cleaningTypes', Azl_Catalog::lists(), true ), 'saved like the other lists' );
		$rev = Azl_Catalog::get()['catalogRev'];
		$types = Azl_Catalog::get()['cleaningTypes'];
		$types[6]['active'] = false; // archive Turndown
		eq( 200, Azl_Catalog::save( 'cleaningTypes', $types, $rev )[0] );
		eq( array( 'ok' => false, 'error' => 'Choose the cleaning type.' ), cmd( clt_log( array( 'cleanType' => 'turndown' ) ) ), 'an archived type takes no new work' );
	}
);

test(
	'cleaning: Log Cleaning clocks in now or queues; validation runs before anything is written',
	function () {
		$c = clt_log();
		has( array( 'ok' => true, 'applied' => true ), cmd( $c ) );
		has( array( 'room' => '201', 'type' => 'regular', 'status' => 'in_progress', 'assignee' => JOEL, 'role' => 'lead', 'clock_in' => (string) Azl_Db::now(), 'clock_out' => null ), clt_row( $c['taskId'] ) );
		eq( array( 'Logged and clocked in' ), labels( $c['taskId'] ) );
		$q = clt_log( array( 'clockIn' => false, 'attendantId' => null, 'role' => 'backup', 'room' => '202' ) );
		unset( $q['attendantId'] );
		cmd( $q );
		has( array( 'status' => 'queued', 'assignee' => null, 'role' => 'backup', 'clock_in' => null ), clt_row( $q['taskId'] ) );
		$before = fingerprint();
		foreach (
			array(
				array( array( 'room' => ' ' ), 'Room required' ),
				array( array( 'room' => str_repeat( '9', 41 ) ), 'Room required' ),
				array( array( 'cleanType' => 'Regular' ), 'Choose the cleaning type.' ),
				array( array( 'role' => 'boss' ), 'Choose Lead or Backup.' ),
				array( array( 'clockIn' => 'yes' ), 'Choose whether to clock in now.' ),
				array( array( 'attendantId' => RAMON ), 'Choose a room attendant from Housekeeping.' ),
				array( array( 'taskId' => $c['taskId'] ), 'This cleaning task already exists.' ),
			) as list( $over, $error )
		) {
			eq( array( 'ok' => false, 'error' => $error ), cmd( clt_log( $over ) ), $error );
		}
		$no_ra = clt_log();
		unset( $no_ra['attendantId'] );
		eq( array( 'ok' => false, 'error' => 'Choose the room attendant who clocks in.' ), cmd( $no_ra ) );
		eq( $before, fingerprint(), 'refusals write nothing' );
	}
);

test(
	'cleaning: Schedule Rooms makes one scheduled task per room for the date, and refuses duplicates and bad ids',
	function () {
		$ids = array( id(), id(), id() );
		$c   = array( 'type' => 'scheduleClean', 'taskIds' => $ids, 'rooms' => array( '305', ' 408 ', '501' ), 'date' => '2027-01-15', 'cleanType' => 'checkout' );
		eq( array( 'ok' => true, 'applied' => true, 'scheduled' => 3 ), cmd( $c ) );
		foreach ( $ids as $i => $id ) {
			has( array( 'room' => array( '305', '408', '501' )[ $i ], 'type' => 'checkout', 'status' => 'scheduled', 'role' => 'lead', 'assignee' => null ), clt_row( $id ) );
			eq( '2027-01-15', Azl_Module_WorkOrders::ms_date( (int) clt_row( $id )['sched_date'] ) );
			eq( array( 'Scheduled for 2027-01-15' ), labels( $id ) );
		}
		$before = fingerprint();
		$base   = array( 'type' => 'scheduleClean', 'date' => '2027-01-15', 'cleanType' => 'checkout' );
		foreach (
			array(
				array( array( 'taskIds' => array( id() ), 'rooms' => array( '1' ), 'date' => '' ), 'Date required' ),
				array( array( 'taskIds' => array(), 'rooms' => array() ), 'Add rooms' ),
				array( array( 'taskIds' => array( id(), id() ), 'rooms' => array( '7', '7' ) ), 'Room 7 is listed twice.' ),
				array( array( 'taskIds' => array( id(), id() ), 'rooms' => array( '7', '' ) ), 'Room 2: enter a room of 1 to 40 characters.' ),
				array( array( 'taskIds' => array( id() ), 'rooms' => array( '7', '8' ) ), 'Invalid id' ),
				array( array( 'taskIds' => array( 'x', id() ), 'rooms' => array( '7', '8' ) ), 'Invalid id' ),
				array( array( 'taskIds' => array( $ids[0] ), 'rooms' => array( '9' ) ), 'This cleaning task already exists.' ),
				array( array( 'taskIds' => array_map( 'id', range( 1, 31 ) ), 'rooms' => array_map( 'strval', range( 1, 31 ) ) ), 'Schedule at most 30 rooms at a time.' ),
			) as list( $over, $error )
		) {
			eq( array( 'ok' => false, 'error' => $error ), cmd( $over + $base ), $error );
		}
		eq( $before, fingerprint(), 'refusals write nothing' );
		// The checkout rule of today still readies a scheduled room.
		list( , $items ) = logged( '305', array( 'inspection' ) );
		cmd( array( 'type' => 'finish', 'itemId' => $items[0], 'status' => 'done' ) );
		eq( 'ready', clt_row( $ids[0] )['status'] );
		eq( 'scheduled', clt_row( $ids[1] )['status'] );
	}
);

test(
	'cleaning: the transition table; clock in sets the attendant and time, clock out stamps the end and answers the minutes',
	function () {
		eq(
			array(
				'logClean'      => array( array(), 'in_progress' ),
				'scheduleClean' => array( array(), 'scheduled' ),
				'clockIn'       => array( array( 'ready', 'queued' ), 'in_progress' ),
				'clockOut'      => array( array( 'in_progress' ), 'done' ),
				'editClean'     => array( Azl_Commands::CLEAN_STATUSES, null ),
			),
			Azl_Module_Cleaning::TRANSITIONS,
			'the table as specified'
		);
		foreach ( array( 'clockIn', 'clockOut' ) as $type ) {
			foreach ( Azl_Commands::CLEAN_STATUSES as $from ) {
				$t = clean_task( '7' . strlen( $from ), $from );
				Azl_Db::update( 'clean_tasks', array( 'assignee' => JOEL, 'clock_in' => Azl_Db::now() ), array( 'id' => $t ) );
				$r       = cmd( array( 'type' => $type, 'taskId' => $t ) );
				$allowed = in_array( $from, Azl_Module_Cleaning::TRANSITIONS[ $type ][0], true );
				if ( $allowed ) {
					has( array( 'ok' => true ), $r, "$type from $from" );
				} else {
					eq( array( 'ok' => false, 'error' => 'Not possible while the room is ' . str_replace( '_', ' ', $from ) ), $r, "$type from $from" );
				}
				eq( $allowed ? Azl_Module_Cleaning::TRANSITIONS[ $type ][1] : $from, clt_row( $t )['status'] );
			}
		}
		$t = clean_task( '305', 'ready' );
		eq( array( 'ok' => false, 'error' => 'Choose the room attendant who clocks in.' ), cmd( array( 'type' => 'clockIn', 'taskId' => $t ) ) );
		eq( array( 'ok' => false, 'error' => 'Choose a room attendant from Housekeeping.' ), cmd( array( 'type' => 'clockIn', 'taskId' => $t, 'attendantId' => RAMON ) ) );
		eq( array( 'ok' => false, 'error' => 'Unknown cleaning task' ), cmd( array( 'type' => 'clockIn', 'taskId' => id(), 'attendantId' => JOEL ) ) );
		$t0 = Azl_Db::now();
		cmd( array( 'type' => 'clockIn', 'taskId' => $t, 'attendantId' => JOEL, 'role' => 'backup' ) );
		has( array( 'status' => 'in_progress', 'assignee' => JOEL, 'role' => 'backup', 'clock_in' => (string) $t0 ), clt_row( $t ) );
		azl_advance( 27 * 60000 + 30000 );
		eq( array( 'ok' => true, 'applied' => true, 'minutes' => 27 ), cmd( array( 'type' => 'clockOut', 'taskId' => $t ) ) );
		has( array( 'status' => 'done', 'clock_out' => (string) Azl_Db::now() ), clt_row( $t ) );
	}
);

test(
	'cleaning: editClean changes only what differs and keeps a scheduled room dated and a running clean attended',
	function () {
		$ids = array( id() );
		cmd( array( 'type' => 'scheduleClean', 'taskIds' => $ids, 'rooms' => array( '408' ), 'date' => '2027-01-15', 'cleanType' => 'checkout' ) );
		$t = $ids[0];
		eq( array( 'ok' => false, 'error' => 'Nothing to change.' ), cmd( array( 'type' => 'editClean', 'taskId' => $t, 'room' => '408', 'cleanType' => 'checkout' ) ) );
		eq( array( 'ok' => false, 'error' => 'A scheduled room needs its date.' ), cmd( array( 'type' => 'editClean', 'taskId' => $t, 'schedDate' => '' ) ) );
		eq( array( 'ok' => false, 'error' => 'Choose a room attendant from Housekeeping.' ), cmd( array( 'type' => 'editClean', 'taskId' => $t, 'attendantId' => RAMON ) ) );
		has( array( 'ok' => true ), cmd( array( 'type' => 'editClean', 'taskId' => $t, 'room' => '409', 'cleanType' => 'deep_clean', 'attendantId' => JOEL, 'role' => 'backup', 'schedDate' => '2027-01-16' ) ) );
		has( array( 'room' => '409', 'type' => 'deep_clean', 'assignee' => JOEL, 'role' => 'backup' ), clt_row( $t ) );
		eq( 'Edited: room, type, attendant, role, scheduled date', labels( $t )[1] );
		$run = clean_task( '410', 'in_progress' );
		Azl_Db::update( 'clean_tasks', array( 'assignee' => JOEL ), array( 'id' => $run ) );
		eq( array( 'ok' => false, 'error' => 'A room being cleaned keeps its attendant.' ), cmd( array( 'type' => 'editClean', 'taskId' => $run, 'clearAttendant' => true ) ) );
		// An old row's type label is kept until someone picks a type from the list.
		$old = clean_task( '411', 'queued' );
		has( array( 'ok' => true ), cmd( array( 'type' => 'editClean', 'taskId' => $old, 'room' => '412' ) ) );
		eq( 'Checkout', clt_row( $old )['type'] );
	}
);

test(
	'cleaning: replays change nothing, and the built-in cleanSet now stamps the clock times',
	function () {
		twice( clt_log() );
		twice( array( 'type' => 'scheduleClean', 'taskIds' => array( id(), id() ), 'rooms' => array( '1', '2' ), 'date' => '2027-01-15', 'cleanType' => 'checkout' ) );
		$t = clean_task( '3', 'ready' );
		twice( array( 'type' => 'clockIn', 'taskId' => $t, 'attendantId' => JOEL ) );
		twice( array( 'type' => 'clockOut', 'taskId' => $t ) );
		twice( array( 'type' => 'editClean', 'taskId' => $t, 'role' => 'backup' ) );
		$u = clean_task( '4', 'ready' );
		cmd( array( 'type' => 'cleanSet', 'taskId' => $u, 'status' => 'in_progress' ) );
		$in = clt_row( $u )['clock_in'];
		eq( (string) Azl_Db::now(), $in );
		azl_advance( 5000 );
		cmd( array( 'type' => 'cleanSet', 'taskId' => $u, 'status' => 'done' ) );
		has( array( 'clock_in' => $in, 'clock_out' => (string) Azl_Db::now() ), clt_row( $u ) );
	}
);

test(
	'cleaning: the role matrix: Housekeeping staff on a phone act, other staff do not see it, managers act',
	function () {
		access_accounts();
		$GLOBALS['azl_wp']['user'] = ACC_PHONE;
		has( array( 'ok' => true ), cmd( clt_log(), JOEL ) );
		has( array( 'ok' => true ), cmd( clt_log(), MARIA ), 'the help desk officer' );
		has( array( 'ok' => true ), cmd( clt_log(), LIZA ), 'the housekeeping supervisor' );
		eq( array( 'ok' => false, 'error' => 'Your role cannot use Cleaning.' ), cmd( clt_log(), RAMON ) );
		eq( array( 'ok' => false, 'error' => 'Sign in with your PIN first.' ), cmd( clt_log(), null ) );
		$GLOBALS['azl_wp']['user'] = ACC_SUP;
		has( array( 'ok' => true ), cmd( clt_log(), null ) );
		$GLOBALS['azl_wp']['user'] = 0;
	}
);

test(
	'cleaning: the snapshot carries role, scheduled date, clock times and creation time',
	function () {
		$c = clt_log( array( 'room' => '301', 'cleanType' => 'deep_clean' ) );
		cmd( $c );
		$ids = array( id() );
		cmd( array( 'type' => 'scheduleClean', 'taskIds' => $ids, 'rooms' => array( '408' ), 'date' => '2027-01-15', 'cleanType' => 'checkout' ) );
		$s     = json_decode( json_encode( Azl_Snapshot::load() ), true );
		$by_id = array_column( $s['cleaning'], null, 'id' );
		eq( array( 'id' => $c['taskId'], 'room' => '301', 'type' => 'deep_clean', 'status' => 'in_progress', 'assignee' => JOEL, 'role' => 'lead', 'clockIn' => Azl_Db::now(), 'createdAt' => Azl_Db::now() ), $by_id[ $c['taskId'] ] );
		has( array( 'status' => 'scheduled', 'role' => 'lead', 'schedDate' => Azl_Module_WorkOrders::date_ms( '2027-01-15' ) ), $by_id[ $ids[0] ] );
	}
);
