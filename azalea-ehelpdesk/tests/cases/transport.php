<?php
/**
 * Transport (includes/Modules/Transport.php): every command, validation before writes, idempotent replay, the role
 * matrix with drivers as "own", the vehicles list, hotel-local scheduled times, the snapshot window, gap-free numbers.
 */

function tr_rows(): array {
	return Azl_Db::rows( 'SELECT * FROM ' . Azl_Db::t( 'trips' ) . ' ORDER BY tr_no' );
}

function tr_slice(): array {
	$snap = json_decode( json_encode( Azl_Snapshot::load( array( 'kind' => 'owner', 'dept' => null ) ) ), true );
	return $snap['modules']['transport'];
}

function tr_fields( array $o = array() ): array {
	return $o + array( 'vehicle' => 'van_1', 'driver' => 'Danny', 'dest' => 'Caticlan Airport', 'purpose' => 'Guest pickup', 'passengers' => 'Mr. & Mrs. Lee' );
}

/** Logs a trip that leaves now. */
function tr_log( array $o = array(), ?string $actor = MARIA ): string {
	$id = id();
	has( array( 'ok' => true, 'applied' => true ), cmd( array( 'type' => 'logTrip', 'tripId' => $id ) + tr_fields( $o ), $actor ), 'logTrip' );
	return $id;
}

/** Schedules a trip for a hotel-local date and time. */
function tr_schedule( string $date = '2027-01-16', string $time = '14:00', array $o = array(), ?string $actor = MARIA ): string {
	$id = id();
	has( array( 'ok' => true, 'applied' => true ), cmd( array( 'type' => 'scheduleTrip', 'tripId' => $id, 'date' => $date, 'time' => $time ) + tr_fields( $o ), $actor ), 'scheduleTrip' );
	return $id;
}

function tr_row( string $id ): array {
	return Azl_Db::row( 'SELECT * FROM ' . Azl_Db::t( 'trips' ) . ' WHERE id = %s', array( $id ) );
}

function tr_as( int $account, ?string $actor, array $c ): string {
	$GLOBALS['azl_wp']['user'] = $account;
	$r                         = cmd( $c, $actor );
	$GLOBALS['azl_wp']['user'] = 0;
	return true === $r['ok'] ? 'ok' : $r['error'];
}

test(
	'transport: the table, the counter, the vehicles list and numbers TR-0001, gap free',
	function () {
		ok( null !== Azl_Modules::get( 'transport' ), 'registered with the plugin' );
		ok( null !== Azl_Db::val( "SELECT name FROM sqlite_master WHERE type = 'table' AND name = %s", array( Azl_Db::t( 'trips' ) ) ), 'table' );
		eq( array( 'Van 1', 'Van 2', 'Shuttle' ), array_column( Azl_Catalog::get()['vehicles'], 'label' ), 'seeded with the prototype\'s vehicles' );
		$a = id();
		eq( array( 'ok' => true, 'applied' => true, 'trNo' => 1 ), cmd( array( 'type' => 'logTrip', 'tripId' => $a ) + tr_fields() ) );
		eq( 'Destination required', cmd( array( 'type' => 'logTrip', 'tripId' => id() ) + tr_fields( array( 'dest' => '' ) ) )['error'] );
		eq( 'This trip already exists.', cmd( array( 'type' => 'logTrip', 'tripId' => $a ) + tr_fields() )['error'] );
		azl_advance( 1000 );
		has( array( 'trNo' => 2 ), cmd( array( 'type' => 'scheduleTrip', 'tripId' => id(), 'date' => '2027-01-16', 'time' => '09:00' ) + tr_fields() ) );
		eq( 2, Azl_Db::counter( 'tr' ) );
		eq( array( 'TR-0002', 'TR-0001' ), array_column( tr_slice()['trips'], 'no' ) );
		eq( array( array( 'key' => 'van_1', 'label' => 'Van 1', 'active' => true ), array( 'key' => 'van_2', 'label' => 'Van 2', 'active' => true ), array( 'key' => 'shuttle', 'label' => 'Shuttle', 'active' => true ) ), tr_slice()['vehicles'] );
	}
);

test(
	'transport: a logged trip leaves now: en route, with the departure time, the vehicle\'s name, the cleaned text and who logged it',
	function () {
		$id = tr_log( array( 'driver' => ' <b>Danny</b> ', 'purpose' => 'Guest <i>pickup</i>' ) );
		$r  = tr_row( $id );
		has( array( 'status' => 'en_route', 'vehicle' => 'Van 1', 'vehicle_key' => 'van_1', 'driver' => 'Danny', 'purpose' => 'Guest pickup', 'created_by' => MARIA, 'dep_at' => (string) Azl_Db::now() ), $r );
		ok( null === $r['sched_at'] && null === $r['arr_at'], 'no scheduled or arrival time' );
		eq( array( 'Logged' ), labels( $id ) );
		has( array( 'no' => 'TR-0001', 'status' => 'en_route', 'depAt' => Azl_Db::now(), 'driver' => 'Danny' ), tr_slice()['trips'][0] );
	}
);

test(
	'transport: a scheduled time is the hotel\'s local time (Asia/Manila) stored as one moment, never read as UTC',
	function () {
		$id = tr_schedule( '2027-01-16', '14:00' );
		eq( (string) ( gmmktime( 6, 0, 0, 1, 16, 2027 ) * 1000 ), tr_row( $id )['sched_at'], '14:00 in Manila is 06:00 UTC' );
		$early = tr_schedule( '2027-01-16', '06:30' ); // before 8 AM local: the UTC date is still the 15th
		eq( (string) ( gmmktime( 22, 30, 0, 1, 15, 2027 ) * 1000 ), tr_row( $early )['sched_at'] );
		eq( 'scheduled', tr_row( $id )['status'] );
		ok( null === tr_row( $id )['dep_at'], 'not departed' );
		eq( array( 'Scheduled' ), labels( $id ) );
	}
);

test(
	'transport: bad input is refused with a plain message and writes nothing, not even a number',
	function () {
		$before = fingerprint();
		$log    = array( 'type' => 'logTrip', 'tripId' => id() );
		$sched  = array( 'type' => 'scheduleTrip', 'tripId' => id(), 'date' => '2027-01-16', 'time' => '14:00' );
		foreach (
			array(
				array( $log, array( 'dest' => '  ' ), 'Destination required' ),
				array( $log, array( 'dest' => 7 ), 'Destination required' ),
				array( $log, array( 'dest' => str_repeat( 'x', 161 ) ), 'Keep the dest under 160 characters.' ),
				array( $log, array( 'driver' => str_repeat( 'x', 121 ) ), 'Keep the driver under 120 characters.' ),
				array( $log, array( 'passengers' => str_repeat( 'x', 161 ) ), 'Keep the passengers under 160 characters.' ),
				array( $log, array( 'vehicle' => 'zeppelin' ), 'Choose a vehicle.' ),
				array( $log, array( 'vehicle' => null ), 'Choose a vehicle.' ),
				array( $sched, array( 'date' => '2027-02-30' ), 'Choose a date and a time.' ),
				array( $sched, array( 'date' => '2027-1-16' ), 'Choose a date and a time.' ),
				array( $sched, array( 'time' => '25:00' ), 'Choose a date and a time.' ),
				array( $sched, array( 'time' => '2 PM' ), 'Choose a date and a time.' ),
				array( $sched, array( 'date' => null ), 'Choose a date and a time.' ),
				array( $sched, array( 'date' => '2020-01-01' ), 'Choose a date from yesterday to a year ahead.' ),
				array( $sched, array( 'date' => '2029-01-01' ), 'Choose a date from yesterday to a year ahead.' ),
			) as list( $base, $bad, $why )
		) {
			eq( array( 'ok' => false, 'error' => $why ), cmd( $bad + $base + tr_fields() ), $base['type'] . ' ' . json_encode( $bad ) );
		}
		eq( array( 'ok' => false, 'error' => 'Invalid id' ), cmd( array( 'type' => 'logTrip', 'tripId' => 'nope' ) + tr_fields() ) );
		eq( array( 'ok' => false, 'error' => 'Invalid id' ), cmd( array( 'type' => 'departTrip' ) ), 'tripId is required' );
		eq( $before, fingerprint(), 'nothing changed' );
		foreach ( array( 'departTrip', 'arriveTrip', 'cancelTrip' ) as $type ) {
			eq( 'Unknown trip', cmd( array( 'type' => $type, 'tripId' => id() ) )['error'], $type );
		}
		eq( 'Unknown trip', cmd( array( 'type' => 'editTrip', 'tripId' => id() ) + tr_fields() )['error'] );
	}
);

test(
	'transport: scheduled, depart, arrive: the times are stamped and a trip cannot skip a step or repeat one',
	function () {
		$id = tr_schedule();
		eq( 'This trip has not left yet. Depart it first.', cmd( array( 'type' => 'arriveTrip', 'tripId' => $id ) )['error'] );
		azl_advance( 3600000 );
		has( array( 'ok' => true, 'applied' => true ), cmd( array( 'type' => 'departTrip', 'tripId' => $id ) ) );
		has( array( 'status' => 'en_route', 'dep_at' => (string) Azl_Db::now() ), tr_row( $id ) );
		eq( 'This trip has already left.', cmd( array( 'type' => 'departTrip', 'tripId' => $id ) )['error'] );
		eq( 'Only a scheduled trip can be cancelled.', cmd( array( 'type' => 'cancelTrip', 'tripId' => $id ) )['error'] );
		azl_advance( 1800000 );
		has( array( 'ok' => true ), cmd( array( 'type' => 'arriveTrip', 'tripId' => $id ) ) );
		has( array( 'status' => 'arrived', 'arr_at' => (string) Azl_Db::now() ), tr_row( $id ) );
		eq( 'This trip has already arrived.', cmd( array( 'type' => 'arriveTrip', 'tripId' => $id ) )['error'] );
		eq( 'This trip has already arrived.', cmd( array( 'type' => 'departTrip', 'tripId' => $id ) )['error'] );
		eq( array( 'Scheduled', 'Departed', 'Arrived' ), labels( $id ) );
		$c = tr_schedule();
		has( array( 'ok' => true ), cmd( array( 'type' => 'cancelTrip', 'tripId' => $c ) ) );
		eq( 'cancelled', tr_row( $c )['status'] );
		eq( 'This trip was cancelled.', cmd( array( 'type' => 'departTrip', 'tripId' => $c ) )['error'] );
		eq( 'This trip was cancelled.', cmd( array( 'type' => 'arriveTrip', 'tripId' => $c ) )['error'] );
		eq( 'Only a scheduled trip can be cancelled.', cmd( array( 'type' => 'cancelTrip', 'tripId' => $c ) )['error'] );
	}
);

test(
	'transport: edit changes a scheduled or en-route trip, refuses a finished one and a change that changes nothing',
	function () {
		$s = tr_schedule( '2027-01-16', '14:00' );
		$e = tr_log();
		$f = array( 'type' => 'editTrip', 'tripId' => $s, 'date' => '2027-01-16', 'time' => '14:00' ) + tr_fields();
		eq( 'Nothing was changed.', cmd( $f )['error'] );
		has( array( 'ok' => true ), cmd( array( 'dest' => 'Burnham Park', 'time' => '15:30', 'vehicle' => 'van_2' ) + $f ) );
		has( array( 'dest' => 'Burnham Park', 'vehicle' => 'Van 2', 'vehicle_key' => 'van_2', 'sched_at' => (string) ( gmmktime( 7, 30, 0, 1, 16, 2027 ) * 1000 ) ), tr_row( $s ) );
		eq( 'Choose a date and a time.', cmd( array( 'date' => 'x' ) + $f )['error'], 'a scheduled trip needs its time' );
		// En route: the text changes, a date and time are not needed.
		has( array( 'ok' => true ), cmd( array( 'type' => 'editTrip', 'tripId' => $e, 'driver' => 'Jun' ) + tr_fields() ) );
		eq( 'Jun', tr_row( $e )['driver'] );
		cmd( array( 'type' => 'arriveTrip', 'tripId' => $e ) );
		eq( 'A trip that has arrived or was cancelled cannot be changed.', cmd( array( 'type' => 'editTrip', 'tripId' => $e ) + tr_fields() )['error'] );
		eq( 'Choose a vehicle.', cmd( array( 'vehicle' => 'zeppelin' ) + $f )['error'] );
		eq( 'Destination required', cmd( array( 'dest' => '' ) + $f )['error'] );
	}
);

test(
	'transport: a trip keeps the vehicle\'s name from when it was made; renaming or removing the vehicle later changes nothing',
	function () {
		$id  = tr_log();
		$cat = Azl_Catalog::get();
		$new = array_map(
			static function ( $v ) {
				return 'van_1' === $v['key'] ? array( 'key' => 'van_1', 'label' => 'Van One (new)', 'active' => false ) : $v;
			},
			$cat['vehicles']
		);
		eq( 200, Azl_Catalog::save( 'vehicles', $new, $cat['catalogRev'] )[0] );
		eq( 'Van 1', tr_slice()['trips'][0]['vehicle'], 'the log keeps the old name' );
		ok( false === tr_slice()['vehicles'][0]['active'], 'the slice shows the vehicle archived' );
		eq( 'Choose a vehicle.', cmd( array( 'type' => 'logTrip', 'tripId' => id() ) + tr_fields() )['error'], 'an archived vehicle is not offered for new trips' );
		// The trip on the road can still be edited without touching its (removed) vehicle.
		has( array( 'ok' => true ), cmd( array( 'type' => 'editTrip', 'tripId' => $id ) + tr_fields( array( 'dest' => 'SM Baguio' ) ) ) );
		eq( 'Van 1', tr_row( $id )['vehicle'] );
		eq( 'SM Baguio', tr_row( $id )['dest'] );
	}
);

test(
	'transport: every command applies once; a replay changes nothing and answers the same',
	function () {
		$a = id();
		list( $first, $again ) = twice( array( 'type' => 'logTrip', 'tripId' => $a ) + tr_fields() );
		eq( array( 1, 1 ), array( $first['trNo'], $again['trNo'] ) );
		$b = id();
		list( $first, $again ) = twice( array( 'type' => 'scheduleTrip', 'tripId' => $b, 'date' => '2027-01-17', 'time' => '08:00' ) + tr_fields() );
		eq( array( 2, 2 ), array( $first['trNo'], $again['trNo'] ) );
		eq( 2, Azl_Db::counter( 'tr' ) );
		twice( array( 'type' => 'editTrip', 'tripId' => $b, 'date' => '2027-01-17', 'time' => '09:00' ) + tr_fields() );
		twice( array( 'type' => 'departTrip', 'tripId' => $b ) );
		twice( array( 'type' => 'arriveTrip', 'tripId' => $a ) );
		$c = tr_schedule();
		twice( array( 'type' => 'cancelTrip', 'tripId' => $c ) );
	}
);

test(
	'transport: the role matrix: the desk and managers do everything; a driver may only depart and arrive their own trips',
	function () {
		access_accounts();
		$new = static function () {
			return array( 'type' => 'logTrip', 'tripId' => id() ) + tr_fields();
		};
		foreach ( array( ACC_OWNER, ACC_MANAGER, ACC_SUP ) as $acct ) {
			eq( 'ok', tr_as( $acct, null, $new() ), "account $acct logs" );
		}
		eq( 'ok', tr_as( ACC_PHONE, MARIA, $new() ), 'help-desk officer' );
		eq( 'ok', tr_as( ACC_PHONE, LIZA, $new() ), 'supervisor on a phone' );

		// Joel Dizon (department staff) drives Van 1 today.
		$mine   = tr_schedule( '2027-01-16', '08:00', array( 'driver' => 'joel dizon' ) );
		$theirs = tr_schedule( '2027-01-16', '09:00', array( 'driver' => 'Danny' ) );
		eq( 'ok', tr_as( ACC_PHONE, JOEL, array( 'type' => 'departTrip', 'tripId' => $mine ) ), 'depart own' );
		eq( 'ok', tr_as( ACC_PHONE, JOEL, array( 'type' => 'arriveTrip', 'tripId' => $mine ) ), 'arrive own' );
		eq( Azl_Module_Transport::NOT_YOURS, tr_as( ACC_PHONE, JOEL, array( 'type' => 'departTrip', 'tripId' => $theirs ) ), 'not their trip' );
		eq( 'scheduled', tr_row( $theirs )['status'], 'and nothing changed' );
		foreach ( array( $new(), array( 'type' => 'scheduleTrip', 'tripId' => id(), 'date' => '2027-01-16', 'time' => '10:00' ) + tr_fields(), array( 'type' => 'editTrip', 'tripId' => $mine ) + tr_fields(), array( 'type' => 'cancelTrip', 'tripId' => $theirs ) ) as $c ) {
			eq( Azl_Module_Transport::DESK_ONLY, tr_as( ACC_PHONE, JOEL, $c ), 'staff cannot ' . $c['type'] );
		}
		// Somebody whose name is not the driver's, even in another department, is refused too.
		eq( Azl_Module_Transport::NOT_YOURS, tr_as( ACC_PHONE, RAMON, array( 'type' => 'departTrip', 'tripId' => $theirs ) ) );
		eq( 'Sign in with your PIN first.', tr_as( ACC_PHONE, null, array( 'type' => 'departTrip', 'tripId' => $theirs ) ) );
		eq( 'scheduled', tr_row( $theirs )['status'] );
	}
);

test(
	'transport: the snapshot window: trips still to run or on the road always show, finished ones drop out after 14 days',
	function () {
		$old_done  = tr_log( array( 'dest' => 'Old arrived' ) );
		cmd( array( 'type' => 'arriveTrip', 'tripId' => $old_done ) );
		azl_advance( 1000 );
		$old_road  = tr_log( array( 'dest' => 'Still out' ) );
		azl_advance( 1000 );
		$old_sched = tr_schedule( '2027-01-16', '08:00', array( 'dest' => 'Waiting' ) );
		azl_advance( 15 * 86400000 );
		$fresh = tr_log( array( 'dest' => 'Fresh' ) );
		cmd( array( 'type' => 'arriveTrip', 'tripId' => $fresh ) );
		$dests = array_column( tr_slice()['trips'], 'dest' );
		eq( array( 'Fresh', 'Waiting', 'Still out' ), $dests, 'newest first; the 15 day old arrived trip is gone' );
		access_accounts();
		$as = static function ( array $who ): array {
			return array_keys( json_decode( json_encode( Azl_Snapshot::load( $who ) ), true )['modules'] );
		};
		ok( in_array( 'transport', $as( array( 'kind' => 'staff', 'dept' => 'housekeeping' ) ), true ), 'drivers read the log' );
		ok( ! in_array( 'transport', $as( array( 'kind' => 'none', 'dept' => null ) ), true ), 'no slice without access' );
		ok( ! array_key_exists( 'badge', tr_slice() ), 'no badge number: Transport has no sidebar badge' );
		unset( $old_road, $old_sched );
	}
);
