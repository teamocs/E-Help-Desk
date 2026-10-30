<?php
/**
 * House Status (includes/Modules/HouseStatus.php): every command, validation before writes, idempotent replay, the
 * role matrix per actor, the snapshot window and gap-free numbering.
 */

function hs_rows(): array {
	return Azl_Db::rows( 'SELECT * FROM ' . Azl_Db::t( 'house_logs' ) . ' ORDER BY hs_no' );
}

/** Logs a house status and returns its id. */
function hs_log( string $narration = 'Water pressure low on the 3rd floor', string $status = 'monitoring', ?string $actor = MARIA ): string {
	$id = id();
	has( array( 'ok' => true, 'applied' => true ), cmd( array( 'type' => 'logHouse', 'houseId' => $id, 'narration' => $narration, 'status' => $status ), $actor ), 'logHouse' );
	return $id;
}

function hs_logs(): array {
	$snap = json_decode( json_encode( Azl_Snapshot::load( array( 'kind' => 'owner', 'dept' => null ) ) ), true );
	return $snap['modules']['housestatus'];
}

/** The refusal text (or 'ok') of one command for an actor. */
function hs_as( int $account, ?string $actor, array $c ): string {
	$GLOBALS['azl_wp']['user'] = $account;
	$r                         = cmd( $c, $actor );
	$GLOBALS['azl_wp']['user'] = 0;
	return true === $r['ok'] ? 'ok' : $r['error'];
}

test(
	'housestatus: the module registers its table, its counter and its numbers HS-0001, gap free',
	function () {
		ok( null !== Azl_Modules::get( 'housestatus' ), 'registered with the plugin' );
		ok( null !== Azl_Db::val( "SELECT name FROM sqlite_master WHERE type = 'table' AND name = %s", array( Azl_Db::t( 'house_logs' ) ) ), 'table' );
		eq( 0, Azl_Db::counter( 'hs' ) );
		$a = id();
		eq( array( 'ok' => true, 'applied' => true, 'hsNo' => 1 ), cmd( array( 'type' => 'logHouse', 'houseId' => $a, 'narration' => 'Lobby lift 2 out of service', 'status' => 'pending' ) ) );
		// A refused log (bad input, then a clashing id) never uses a number.
		eq( 'Incident narration is required.', cmd( array( 'type' => 'logHouse', 'houseId' => id(), 'narration' => '  ', 'status' => 'pending' ) )['error'] );
		eq( 'This log already exists.', cmd( array( 'type' => 'logHouse', 'houseId' => $a, 'narration' => 'Again', 'status' => 'pending' ) )['error'] );
		azl_advance( 1000 );
		has( array( 'hsNo' => 2 ), cmd( array( 'type' => 'logHouse', 'houseId' => id(), 'narration' => 'Generator test at 2 PM', 'status' => 'monitoring' ) ) );
		eq( 2, Azl_Db::counter( 'hs' ) );
		eq( array( 1, 2 ), array_map( 'intval', array_column( hs_rows(), 'hs_no' ) ) );
		eq( array( 'HS-0002', 'HS-0001' ), array_column( hs_logs()['logs'], 'no' ), 'newest first' );
	}
);

test(
	'housestatus: logging stores the narration cleaned, the status, who logged it and the time',
	function () {
		$id = hs_log( "Pump <b>reset</b>\nwatching it", 'monitoring' );
		$r  = hs_rows()[0];
		eq( "Pump reset\nwatching it", $r['narration'] );
		eq( 'monitoring', $r['status'] );
		eq( MARIA, $r['logged_by'] );
		eq( (string) Azl_Db::now(), $r['created_at'] );
		eq( array( 'Logged' ), labels( $id ) );
		$log = hs_logs()['logs'][0];
		has( array( 'id' => $id, 'no' => 'HS-0001', 'status' => 'monitoring', 'loggedBy' => MARIA, 'createdAt' => Azl_Db::now(), 'updates' => array() ), $log );
		ok( ! array_key_exists( 'closedAt', $log ), 'no closing time yet' );
	}
);

test(
	'housestatus: bad input is refused with a plain message and writes nothing, not even a number',
	function () {
		$before = fingerprint();
		$ok     = array( 'type' => 'logHouse', 'houseId' => id(), 'narration' => 'Fine', 'status' => 'monitoring' );
		foreach (
			array(
				array( array( 'narration' => '' ), 'Incident narration is required.' ),
				array( array( 'narration' => '<i></i>' ), 'Incident narration is required.' ),
				array( array( 'narration' => 42 ), 'Incident narration is required.' ),
				array( array( 'narration' => str_repeat( 'x', 2001 ) ), 'Keep the narration under 2000 characters.' ),
				array( array( 'status' => 'closed' ), 'Choose Monitoring or Pending.' ),
				array( array( 'status' => 'nonsense' ), 'Choose Monitoring or Pending.' ),
				array( array( 'status' => null ), 'Choose Monitoring or Pending.' ),
			) as list( $bad, $why )
		) {
			eq( array( 'ok' => false, 'error' => $why ), cmd( $bad + $ok ), json_encode( $bad ) );
		}
		eq( array( 'ok' => false, 'error' => 'Invalid id' ), cmd( array( 'houseId' => 'nope' ) + $ok ) );
		eq( array( 'ok' => false, 'error' => 'Invalid id' ), cmd( array( 'type' => 'updateHouse', 'text' => 'x' ) ), 'houseId is required' );
		eq( $before, fingerprint(), 'nothing changed' );
		$log = hs_log();
		foreach (
			array(
				array( array( 'type' => 'updateHouse', 'text' => ' ' ), 'Update is required.' ),
				array( array( 'type' => 'updateHouse', 'text' => str_repeat( 'x', 2001 ) ), 'Keep the update under 2000 characters.' ),
				array( array( 'type' => 'closeHouse', 'note' => str_repeat( 'x', 2000 ) ), 'Keep the closing note under 1998 characters.' ),
				array( array( 'type' => 'editHouse', 'narration' => 'x', 'status' => 'bogus' ), 'Choose Monitoring, Pending or Closed.' ),
				array( array( 'type' => 'editHouse', 'narration' => '', 'status' => 'pending' ), 'Incident narration is required.' ),
			) as list( $bad, $why )
		) {
			eq( array( 'ok' => false, 'error' => $why ), cmd( $bad + array( 'houseId' => $log ) ), json_encode( $bad ) );
		}
		eq( 'Unknown log', cmd( array( 'type' => 'updateHouse', 'houseId' => id(), 'text' => 'x' ) )['error'] );
		eq( 'Unknown log', cmd( array( 'type' => 'closeHouse', 'houseId' => id() ) )['error'] );
		eq( 'Unknown log', cmd( array( 'type' => 'reopenHouse', 'houseId' => id() ) )['error'] );
		eq( 'Unknown log', cmd( array( 'type' => 'editHouse', 'houseId' => id(), 'narration' => 'x', 'status' => 'pending' ) )['error'] );
	}
);

test(
	'housestatus: updates build a thread; closing adds the note; a closed log takes no update; reopen goes back to monitoring',
	function () {
		$id = hs_log();
		azl_advance( 60000 );
		has( array( 'ok' => true ), cmd( array( 'type' => 'updateHouse', 'houseId' => $id, 'text' => 'Engineering checking pump' ), RAMON ) );
		azl_advance( 60000 );
		has( array( 'ok' => true ), cmd( array( 'type' => 'updateHouse', 'houseId' => $id, 'text' => 'Pump reset, monitoring' ) ) );
		azl_advance( 60000 );
		has( array( 'ok' => true ), cmd( array( 'type' => 'closeHouse', 'houseId' => $id, 'note' => 'Pressure back to normal' ) ) );
		$log = hs_logs()['logs'][0];
		eq( 'closed', $log['status'] );
		eq( Azl_Db::now(), $log['closedAt'] );
		eq(
			array( array( RAMON, 'Engineering checking pump' ), array( MARIA, 'Pump reset, monitoring' ), array( MARIA, 'Closed: Pressure back to normal' ) ),
			array_map( null, array_column( $log['updates'], 'by' ), array_column( $log['updates'], 'text' ) )
		);
		eq( 'This log is closed. Reopen it to add an update.', cmd( array( 'type' => 'updateHouse', 'houseId' => $id, 'text' => 'More' ) )['error'] );
		eq( 'This log is already closed.', cmd( array( 'type' => 'closeHouse', 'houseId' => $id ) )['error'] );
		azl_advance( 60000 );
		has( array( 'ok' => true ), cmd( array( 'type' => 'reopenHouse', 'houseId' => $id ) ) );
		$log = hs_logs()['logs'][0];
		eq( 'monitoring', $log['status'] );
		ok( ! array_key_exists( 'closedAt', $log ), 'closing time cleared' );
		eq( 'Reopened', end( $log['updates'] )['text'] );
		eq( 'This log is not closed.', cmd( array( 'type' => 'reopenHouse', 'houseId' => $id ) )['error'] );
		// Closing without a note still leaves a line in the thread.
		has( array( 'ok' => true ), cmd( array( 'type' => 'closeHouse', 'houseId' => $id ) ) );
		eq( 'Closed', end( hs_logs()['logs'][0]['updates'] )['text'] );
	}
);

test(
	'housestatus: edit moves a log between any two statuses, keeps the closing time while closed and records what changed',
	function () {
		$id = hs_log( 'Lobby lift 2 out of service', 'pending' );
		eq( 'Nothing was changed.', cmd( array( 'type' => 'editHouse', 'houseId' => $id, 'narration' => 'Lobby lift 2 out of service', 'status' => 'pending' ) )['error'] );
		azl_advance( 1000 );
		has( array( 'ok' => true ), cmd( array( 'type' => 'editHouse', 'houseId' => $id, 'narration' => 'Lobby lift 2 out of service, parts ordered', 'status' => 'closed' ) ) );
		$closed_at = Azl_Db::now();
		$log       = hs_logs()['logs'][0];
		has( array( 'status' => 'closed', 'narration' => 'Lobby lift 2 out of service, parts ordered', 'closedAt' => $closed_at ), $log );
		eq( 'Edited: narration changed, status pending to closed', $log['updates'][0]['text'] );
		azl_advance( 5000 );
		cmd( array( 'type' => 'editHouse', 'houseId' => $id, 'narration' => 'Lobby lift 2 repaired', 'status' => 'closed' ) );
		eq( $closed_at, hs_logs()['logs'][0]['closedAt'], 'editing a closed log does not move its closing time' );
		azl_advance( 5000 );
		cmd( array( 'type' => 'editHouse', 'houseId' => $id, 'narration' => 'Lobby lift 2 repaired', 'status' => 'monitoring' ) );
		$log = hs_logs()['logs'][0];
		eq( 'monitoring', $log['status'] );
		ok( ! array_key_exists( 'closedAt', $log ), 'opened by an edit: closing time cleared' );
		eq( 3, count( $log['updates'] ) );
	}
);

test(
	'housestatus: every command applies once; a replay changes nothing and answers the same',
	function () {
		$id = id();
		list( $first, $again ) = twice( array( 'type' => 'logHouse', 'houseId' => $id, 'narration' => 'Water pressure low', 'status' => 'monitoring' ) );
		eq( 1, $first['hsNo'] );
		eq( 1, $again['hsNo'], 'a replayed log answers with its number' );
		eq( 1, Azl_Db::counter( 'hs' ) );
		twice( array( 'type' => 'updateHouse', 'houseId' => $id, 'text' => 'Checking' ) );
		eq( 1, count( hs_logs()['logs'][0]['updates'] ), 'one note, not two' );
		twice( array( 'type' => 'editHouse', 'houseId' => $id, 'narration' => 'Water pressure low, 3rd floor', 'status' => 'pending' ) );
		twice( array( 'type' => 'closeHouse', 'houseId' => $id, 'note' => 'Fixed' ) );
		twice( array( 'type' => 'reopenHouse', 'houseId' => $id ) );
		eq( 4, count( hs_logs()['logs'][0]['updates'] ), 'update, edit, close, reopen: four lines' );
	}
);

test(
	'housestatus: the role matrix: the desk, supervisors and managers change logs; department staff and strangers cannot',
	function () {
		access_accounts();
		$id  = hs_log();
		$run = static function ( string $type, array $extra = array() ) use ( $id ): array {
			return array( 'type' => $type, 'houseId' => $id ) + $extra;
		};
		$new = static function () {
			return array( 'type' => 'logHouse', 'houseId' => id(), 'narration' => 'Power dip', 'status' => 'pending' );
		};
		// Accounts: the account's own role decides.
		foreach ( array( ACC_OWNER, ACC_MANAGER, ACC_SUP ) as $acct ) {
			eq( 'ok', hs_as( $acct, null, $new() ), "account $acct logs" );
			eq( 'ok', hs_as( $acct, null, $run( 'updateHouse', array( 'text' => 'x' ) ) ), "account $acct updates" );
		}
		// A shared phone acts as the PIN person's job role.
		eq( 'ok', hs_as( ACC_PHONE, MARIA, $new() ), 'help-desk officer logs' );
		eq( 'ok', hs_as( ACC_PHONE, LIZA, $run( 'closeHouse' ) ), 'supervisor on a phone closes' );
		eq( 'ok', hs_as( ACC_PHONE, MARIA, $run( 'reopenHouse' ) ), 'help-desk officer reopens' );
		foreach ( array( $new(), $run( 'updateHouse', array( 'text' => 'x' ) ), $run( 'closeHouse' ), $run( 'editHouse', array( 'narration' => 'Changed', 'status' => 'pending' ) ), $run( 'reopenHouse' ) ) as $c ) {
			eq( 'Your role can only view House Status.', hs_as( ACC_PHONE, JOEL, $c ), 'department staff is read only: ' . $c['type'] );
			eq( 'Sign in with your PIN first.', hs_as( ACC_PHONE, null, $c ), 'nobody signed in: ' . $c['type'] );
		}
		$n = count( hs_rows() );
		hs_as( ACC_PHONE, JOEL, $new() );
		eq( $n, count( hs_rows() ), 'a refused log writes nothing' );
	}
);

test(
	'housestatus: the snapshot slice: department staff read it, open logs always show, old closed ones drop out, newest first',
	function () {
		access_accounts();
		hs_log( 'Old but still open', 'pending' );
		$old_shut = hs_log( 'Old and closed' );
		cmd( array( 'type' => 'closeHouse', 'houseId' => $old_shut ) );
		azl_advance( 31 * 86400000 );
		$recent = hs_log( 'Recent', 'monitoring' );
		$slice  = hs_logs();
		eq( array( 'Recent', 'Old but still open' ), array_column( $slice['logs'], 'narration' ), 'the 31 day old closed log left the window' );
		eq( 2, $slice['open'], 'the badge: logs not closed' );
		cmd( array( 'type' => 'closeHouse', 'houseId' => $recent ) );
		eq( 1, hs_logs()['open'] );
		eq( 2, count( hs_logs()['logs'] ), 'closed a moment ago stays' );
		$as = static function ( array $who ): array {
			return array_keys( json_decode( json_encode( Azl_Snapshot::load( $who ) ), true )['modules'] );
		};
		ok( in_array( 'housestatus', $as( array( 'kind' => 'staff', 'dept' => 'housekeeping' ) ), true ), 'read access reads' );
		ok( in_array( 'housestatus', $as( array( 'kind' => 'hdo', 'dept' => 'frontdesk' ) ), true ), 'the desk reads it' );
		ok( ! in_array( 'housestatus', $as( array( 'kind' => 'none', 'dept' => null ) ), true ), 'no slice without access' );
	}
);

test(
	'housestatus: the closed list is capped but logs that are not closed are never cut',
	function () {
		for ( $i = 1; $i <= Azl_Module_HouseStatus::CLOSED_CAP + 5; $i++ ) {
			Azl_Db::insert( 'house_logs', array( 'id' => id(), 'hs_no' => $i, 'narration' => "Closed $i", 'status' => 'closed', 'closed_at' => Azl_Db::now(), 'op_id' => id(), 'created_at' => Azl_Db::now() + $i, 'updated_at' => Azl_Db::now() ) );
		}
		Azl_Db::insert( 'house_logs', array( 'id' => id(), 'hs_no' => 999, 'narration' => 'Open one', 'status' => 'pending', 'op_id' => id(), 'created_at' => 1, 'updated_at' => 1 ) );
		$slice = hs_logs();
		eq( Azl_Module_HouseStatus::CLOSED_CAP + 1, count( $slice['logs'] ) );
		eq( 1, $slice['open'] );
		ok( in_array( 'Open one', array_column( $slice['logs'], 'narration' ), true ), 'the open one is there' );
		eq( 'Closed ' . ( Azl_Module_HouseStatus::CLOSED_CAP + 5 ), $slice['logs'][0]['narration'], 'the newest closed ones are kept' );
	}
);
