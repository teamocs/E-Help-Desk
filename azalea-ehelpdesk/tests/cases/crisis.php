<?php
/**
 * Crisis Mgmt (includes/Modules/Crisis.php): the crisis case log behind the safety lane. Every command, its
 * validation, idempotent replays, the role matrix, the snapshot window and the counts the badge uses, and proof that
 * the safety lane (raiseSafety, record911, downgrade, resolve) behaves exactly as before when cases exist.
 */

/** Logs a case with a fresh id; returns [caseId, result]. */
function crisis_log( array $fields = array( 'code' => 'medical_emergency' ), ?string $actor = MARIA ): array {
	$id = id();
	return array( $id, cmd( array( 'type' => 'logCrisis', 'caseId' => $id ) + $fields, $actor ) );
}

function crisis_row( string $id ): ?array {
	return Azl_Db::row( 'SELECT * FROM ' . Azl_Db::t( 'crisis_cases' ) . ' WHERE id = %s', array( $id ) );
}

/** The crisis slice as the desk receives it (JSON round trip). */
function crisis_slice( array $who = array( 'kind' => 'owner', 'dept' => null ) ): ?array {
	$snap = json_decode( json_encode( Azl_Snapshot::load( $who ) ), true );
	return $snap['modules']['crisis'] ?? null;
}

function crisis_case( string $id ): array {
	foreach ( crisis_slice()['cases'] as $c ) {
		if ( $c['id'] === $id ) {
			return $c;
		}
	}
	throw new Azl_Assert_Failed( "case $id not in the snapshot" );
}

/** @return string[] the update lines of a case, oldest first */
function crisis_lines( string $id ): array {
	return array_column( Azl_Updates::list( 'crisis', array( $id ) )[ $id ] ?? array(), 'text' );
}

/** Runs a command as a WordPress account (and PIN person on a shared phone), then signs out again. */
function crisis_as( int $account, ?string $actor, array $c ): array {
	$GLOBALS['azl_wp']['user'] = $account;
	try {
		return cmd( $c, $actor );
	} finally {
		$GLOBALS['azl_wp']['user'] = 0;
	}
}

test(
	'crisis: a case is saved with only a radio code: CR-0001, active, now, nothing else required',
	function () {
		list( $id, $r ) = crisis_log();
		eq( array( 'ok' => true, 'applied' => true, 'caseNo' => 1 ), $r );
		has( array( 'cr_no' => '1', 'code' => 'medical_emergency', 'status' => 'active', 'what' => null, 'comp_cat' => null, 'incident_id' => null, 'logged_by' => MARIA, 'occurred_at' => (string) Azl_Db::now() ), crisis_row( $id ) );
		eq( array( 'Case logged' ), labels( $id ) );
		eq( 1, Azl_Db::counter( 'cr' ) );
		has( array( 'no' => 'CR-0001', 'code' => 'medical_emergency', 'status' => 'active', 'what' => null, 'loggedBy' => 'Maria Santos', 'incident' => null, 'called911' => null, 'updates' => array() ), crisis_case( $id ) );
		// A complaint category alone is enough too, and the full prototype form is accepted.
		has( array( 'ok' => true, 'caseNo' => 2 ), crisis_log( array( 'category' => 'noise' ) )[1] );
		list( $full ) = crisis_log( array( 'code' => 'guest_complaint', 'category' => 'room_condition', 'reportedBy' => ' FO Staff 2 ', 'whoType' => 'in_house_guest', 'who' => 'Ms. Tan', 'location' => 'room', 'place' => '405', 'what' => 'Noise from next room after 11 PM', 'occurredAt' => '2027-01-15T15:56:40+08:00' ) );
		has( array( 'reported_by' => 'FO Staff 2', 'who_type' => 'in_house_guest', 'location' => 'room', 'place' => '405', 'what' => 'Noise from next room after 11 PM', 'occurred_at' => (string) ( 1_800_000_000_000 - 200000 ) ), crisis_row( $full ) );
	}
);

test(
	'crisis: logging refuses nothing chosen, unknown or archived keys, a category with a non-complaint code, bad lengths and times',
	function () {
		$refused = static function ( array $f, string $error ): void {
			eq( array( 'ok' => false, 'error' => $error ), crisis_log( $f )[1], json_encode( $f ) );
		};
		$refused( array(), Azl_Module_Crisis::NEED_ONE );
		$refused( array( 'what' => 'Guest fainted', 'who' => 'Mr. Park' ), Azl_Module_Crisis::NEED_ONE );
		$refused( array( 'code' => 'tsunami' ), 'Unknown code. Pick one from the list.' );
		$refused( array( 'code' => array( 'fire' ) ), 'Not a valid code' );
		$refused( array( 'code' => 'fire', 'category' => 'noise' ), Azl_Module_Crisis::CAT_ONLY );
		$refused( array( 'code' => 'fire', 'location' => 'roof' ), 'Unknown where. Pick one from the list.' );
		$refused( array( 'code' => 'fire', 'who' => str_repeat( 'x', 121 ) ), 'Keep the involved name under 120 characters' );
		$refused( array( 'code' => 'fire', 'what' => str_repeat( 'x', 2001 ) ), 'Keep the what happened under 2000 characters' );
		$bad_time = 'The time is not a valid date (not in the future, at most a year ago)';
		$refused( array( 'code' => 'fire', 'occurredAt' => 'yesterday' ), $bad_time );
		$refused( array( 'code' => 'fire', 'occurredAt' => '2027-01-15T17:00:00+08:00' ), $bad_time ); // an hour ahead
		$refused( array( 'code' => 'fire', 'incidentId' => id() ), Azl_Module_Crisis::NO_ALERT );
		// An archived code is not offered for new cases.
		$cat   = Azl_Catalog::get();
		$codes = array_map( fn( $c ) => 'fire' === $c['key'] ? array( 'active' => false ) + $c : $c, $cat['crisisCodes'] );
		eq( 200, Azl_Catalog::save( 'crisisCodes', $codes, $cat['catalogRev'] )[0] );
		$refused( array( 'code' => 'fire' ), 'Unknown code. Pick one from the list.' );
		eq( 0, (int) Azl_Db::val( 'SELECT COUNT(*) FROM ' . Azl_Db::t( 'crisis_cases' ) ), 'nothing was written' );
		eq( 0, Azl_Db::counter( 'cr' ), 'no number used' );
	}
);

test(
	'crisis: every command is idempotent: a replayed op answers the same and changes nothing; a reused case id is refused',
	function () {
		$id = id();
		list( , $again ) = twice( array( 'type' => 'logCrisis', 'caseId' => $id, 'code' => 'fire' ) );
		eq( 1, $again['caseNo'], 'the replay names the same number' );
		twice( array( 'type' => 'updateCrisis', 'caseId' => $id, 'text' => 'Fire out, smoke clearing' ) );
		twice( array( 'type' => 'editCrisis', 'caseId' => $id, 'code' => 'fire', 'what' => 'Kitchen hood fire' ) );
		twice( array( 'type' => 'monitorCrisis', 'caseId' => $id, 'text' => 'BFP on site' ) );
		$inc = id();
		cmd( array( 'type' => 'raiseSafety', 'incidentId' => $inc, 'room' => 'Kitchen', 'text' => 'smoke', 'hazard' => 'smoke' ) );
		twice( array( 'type' => 'linkCrisisIncident', 'caseId' => $id, 'incidentId' => $inc ) );
		twice( array( 'type' => 'closeCrisis', 'caseId' => $id, 'resolution' => 'BFP cleared the kitchen' ) );
		twice( array( 'type' => 'reopenCrisis', 'caseId' => $id ) );
		list( $plain ) = crisis_log();
		twice( array( 'type' => 'recordCrisis911', 'caseId' => $plain, 'at' => '2027-01-15T08:00:00+08:00' ) );
		eq( array( 'ok' => false, 'error' => 'This case already exists' ), cmd( array( 'type' => 'logCrisis', 'caseId' => $id, 'code' => 'fire' ) ) );
		eq( 2, Azl_Db::counter( 'cr' ) );
		eq( array( 'Fire out, smoke clearing', 'Edited. What happened added: Kitchen hood fire', 'Monitoring: BFP on site', 'Linked to safety alert INC-001', 'Closed: BFP cleared the kitchen', 'Reopened' ), crisis_lines( $id ) );
	}
);

test(
	'crisis: update, monitor, close (a resolution is required), reopen; a closed case takes no updates until reopened',
	function () {
		list( $id ) = crisis_log();
		eq( array( 'ok' => false, 'error' => 'Write the update' ), cmd( array( 'type' => 'updateCrisis', 'caseId' => $id, 'text' => '  ' ) ) );
		has( array( 'ok' => true ), cmd( array( 'type' => 'updateCrisis', 'caseId' => $id, 'text' => 'Ambulance called' ) ) );
		eq( array( 'ok' => false, 'error' => 'Write the monitoring note' ), cmd( array( 'type' => 'monitorCrisis', 'caseId' => $id ) ) );
		has( array( 'ok' => true ), cmd( array( 'type' => 'monitorCrisis', 'caseId' => $id, 'text' => 'Guest taken to hospital' ) ) );
		eq( 'monitoring', crisis_row( $id )['status'] );
		eq( array( 'ok' => false, 'error' => 'This case is already being monitored' ), cmd( array( 'type' => 'monitorCrisis', 'caseId' => $id, 'text' => 'again' ) ) );
		eq( array( 'ok' => false, 'error' => 'Write the resolution' ), cmd( array( 'type' => 'closeCrisis', 'caseId' => $id ) ), 'close requires a resolution' );
		eq( array( 'ok' => false, 'error' => 'Write the resolution' ), cmd( array( 'type' => 'closeCrisis', 'caseId' => $id, 'resolution' => " \n " ) ) );
		eq( array( 'ok' => false, 'error' => 'This case is still open' ), cmd( array( 'type' => 'reopenCrisis', 'caseId' => $id ) ) );
		azl_advance( 5000 );
		has( array( 'ok' => true, 'applied' => true ), cmd( array( 'type' => 'closeCrisis', 'caseId' => $id, 'resolution' => 'Guest released from hospital' ) ) );
		has( array( 'status' => 'resolved', 'resolution' => 'Guest released from hospital', 'resolved_at' => (string) Azl_Db::now() ), crisis_row( $id ) );
		eq( array( 'ok' => false, 'error' => Azl_Module_Crisis::CLOSED ), cmd( array( 'type' => 'updateCrisis', 'caseId' => $id, 'text' => 'late note' ) ) );
		eq( array( 'ok' => false, 'error' => Azl_Module_Crisis::CLOSED ), cmd( array( 'type' => 'closeCrisis', 'caseId' => $id, 'resolution' => 'again' ) ) );
		has( array( 'ok' => true ), cmd( array( 'type' => 'reopenCrisis', 'caseId' => $id ) ) );
		has( array( 'status' => 'monitoring', 'resolution' => null, 'resolved_at' => null ), crisis_row( $id ) );
		eq( array( 'Ambulance called', 'Monitoring: Guest taken to hospital', 'Closed: Guest released from hospital', 'Reopened' ), crisis_lines( $id ), 'the old resolution stays in the log' );
		eq( array( 'Case logged', 'Update added', 'Monitoring', 'Closed', 'Reopened' ), labels( $id ) );
		eq( array( 'ok' => false, 'error' => Azl_Module_Crisis::NO_CASE ), cmd( array( 'type' => 'updateCrisis', 'caseId' => id(), 'text' => 'x' ) ) );
	}
);

test(
	'crisis: edit fills in what happened later and logs every change; an archived key may stay; nothing changed is refused',
	function () {
		list( $id ) = crisis_log( array( 'code' => 'guest_complaint', 'category' => 'noise' ) );
		$edit = static function ( array $f ) use ( $id ): array {
			return cmd( array( 'type' => 'editCrisis', 'caseId' => $id ) + $f );
		};
		has( array( 'ok' => true ), $edit( array( 'code' => 'guest_complaint', 'category' => 'noise', 'what' => 'Party next door', 'who' => 'Ms. Tan', 'location' => 'room', 'place' => '405' ) ) );
		eq( 'Edited. Involved name: none → Ms. Tan; Where: none → Room; Room or place: none → 405; What happened added: Party next door', crisis_lines( $id )[0] );
		eq( array( 'ok' => false, 'error' => 'Nothing changed' ), $edit( array( 'code' => 'guest_complaint', 'category' => 'noise', 'what' => 'Party next door', 'who' => 'Ms. Tan', 'location' => 'room', 'place' => '405' ) ) );
		eq( array( 'ok' => false, 'error' => Azl_Module_Crisis::CAT_ONLY ), $edit( array( 'code' => 'fire', 'category' => 'noise' ) ), 'the category must go when the code changes' );
		eq( array( 'ok' => false, 'error' => Azl_Module_Crisis::NEED_ONE ), $edit( array( 'what' => 'x' ) ) );
		// Archive "noise": the case keeps it while other fields change; it cannot be newly chosen.
		$cat  = Azl_Catalog::get();
		$cats = array_map( fn( $c ) => 'noise' === $c['key'] ? array( 'active' => false ) + $c : $c, $cat['complaintCategories'] );
		eq( 200, Azl_Catalog::save( 'complaintCategories', $cats, $cat['catalogRev'] )[0] );
		has( array( 'ok' => true ), $edit( array( 'code' => 'guest_complaint', 'category' => 'noise', 'what' => 'Party next door, music', 'who' => 'Ms. Tan', 'location' => 'room', 'place' => '405', 'occurredAt' => '2027-01-15T15:30:00+08:00' ) ) );
		eq( 'Edited. What happened: Party next door, music; Time: Jan 15, 4:00 PM → Jan 15, 3:30 PM', crisis_lines( $id )[1], 'times read in Manila time' );
		list( $other ) = crisis_log( array( 'code' => 'guest_complaint' ) );
		eq( array( 'ok' => false, 'error' => 'Unknown category. Pick one from the list.' ), cmd( array( 'type' => 'editCrisis', 'caseId' => $other, 'code' => 'guest_complaint', 'category' => 'noise' ) ) );
		has( array( 'ok' => true ), $edit( array( 'code' => 'fire' ) ) );
		eq( 'Edited. Code: 10-28 Guest Complaint → 10-1 Fire; Category: Noise → none; Involved name: Ms. Tan → none; Where: Room → none; Room or place: 405 → none; What happened: cleared', crisis_lines( $id )[2] );
		has( array( 'code' => 'fire', 'comp_cat' => null, 'what' => null ), crisis_row( $id ) );
	}
);

test(
	'crisis: a safety alert opens a case (hazard code, alert linked) or links one; the case shows the alert and its 911 record',
	function () {
		$inc = id();
		cmd( array( 'type' => 'raiseSafety', 'incidentId' => $inc, 'room' => '412', 'text' => 'guest not breathing', 'hazard' => 'medical' ) );
		cmd( array( 'type' => 'record911', 'incidentId' => $inc, 'at' => '2027-01-15T15:55:00+08:00' ) );
		list( $id, $r ) = crisis_log( array( 'incidentId' => $inc, 'location' => 'room', 'place' => '412', 'what' => 'guest not breathing', 'occurredAt' => '2027-01-15T15:54:00+08:00' ) );
		eq( array( 'ok' => true, 'applied' => true, 'caseNo' => 1 ), $r );
		has( array( 'code' => 'medical_emergency', 'incident_id' => $inc ), crisis_row( $id ), 'the code follows the hazard' );
		eq( array( 'Opened from safety alert INC-001' ), crisis_lines( $id ) );
		has(
			array(
				'incidentId' => $inc,
				'incident'   => array( 'id' => $inc, 'no' => 'INC-001', 'hazard' => 'medical', 'rooms' => array( '412' ), 'status' => 'active', 'createdAt' => Azl_Db::now(), 'called911' => array( 'by' => 'Maria Santos', 'at' => '2027-01-15T07:55:00.000Z' ) ),
				'called911'  => null,
			),
			crisis_case( $id )
		);
		eq( array( 'ok' => false, 'error' => 'Record the 911 call on the linked alert INC-001' ), cmd( array( 'type' => 'recordCrisis911', 'caseId' => $id, 'at' => '2027-01-15T07:56:00+08:00' ) ), 'one call, one record' );
		// A gas alert has no code of its own: Other. An explicit choice wins.
		$gas = id();
		cmd( array( 'type' => 'raiseSafety', 'incidentId' => $gas, 'room' => '220', 'text' => 'amoy gas', 'hazard' => 'gas' ) );
		eq( 'other', crisis_row( crisis_log( array( 'incidentId' => $gas ) )[0] )['code'] );
		eq( 'fire', crisis_row( crisis_log( array( 'incidentId' => $gas, 'code' => 'fire' ) )[0] )['code'] );
		// An existing case links an alert once.
		list( $later ) = crisis_log( array( 'code' => 'security_threat' ) );
		eq( array( 'ok' => false, 'error' => Azl_Module_Crisis::NO_ALERT ), cmd( array( 'type' => 'linkCrisisIncident', 'caseId' => $later, 'incidentId' => id() ) ) );
		has( array( 'ok' => true ), cmd( array( 'type' => 'linkCrisisIncident', 'caseId' => $later, 'incidentId' => $gas ) ) );
		eq( array( 'ok' => false, 'error' => 'This case is already linked to that alert' ), cmd( array( 'type' => 'linkCrisisIncident', 'caseId' => $later, 'incidentId' => $gas ) ) );
		eq( array( 'ok' => false, 'error' => 'This case is already linked to another alert' ), cmd( array( 'type' => 'linkCrisisIncident', 'caseId' => $later, 'incidentId' => $inc ) ) );
		eq( array( 'Linked to safety alert INC-002' ), crisis_lines( $later ) );
		// Linking never changes the alert.
		has( array( 'status' => 'active', 'called911_at' => null ), Azl_Db::row( 'SELECT status, called911_at FROM ' . Azl_Db::t( 'incidents' ) . ' WHERE id = %s', array( $gas ) ) );
	}
);

test(
	'crisis: a case without an alert records its own 911 call once, by name, or as "a manager"',
	function () {
		list( $id ) = crisis_log();
		eq( array( 'ok' => false, 'error' => 'The call time is not a valid date' ), cmd( array( 'type' => 'recordCrisis911', 'caseId' => $id, 'at' => 'now' ) ) );
		has( array( 'ok' => true, 'applied' => true ), cmd( array( 'type' => 'recordCrisis911', 'caseId' => $id, 'at' => '2027-01-15T08:01:00+08:00' ) ) );
		$before = fingerprint();
		eq( array( 'ok' => false, 'error' => Azl_Module_Crisis::LOCKED_911 ), cmd( array( 'type' => 'recordCrisis911', 'caseId' => $id, 'at' => '2027-01-15T08:02:00+08:00' ), null ) );
		eq( $before, fingerprint(), 'the refused second call left no trace' );
		eq( array( 'by' => 'Maria Santos', 'at' => '2027-01-15T00:01:00.000Z' ), crisis_case( $id )['called911'] );
		eq( array( 'BFP/911 called at Jan 15, 8:01 AM' ), crisis_lines( $id ) );
		list( $other ) = crisis_log();
		cmd( array( 'type' => 'recordCrisis911', 'caseId' => $other, 'at' => '2027-01-15T08:03:00+08:00' ), null );
		eq( 'a manager', crisis_case( $other )['called911']['by'] );
	}
);

test(
	'crisis: the role matrix: everyone with access logs and updates; only owner, manager, supervisor (or their PIN) close; a desk officer cannot',
	function () {
		access_accounts();
		$open = static function (): string {
			return crisis_log()[0];
		};
		$close = static function ( string $id ): array {
			return array( 'type' => 'closeCrisis', 'caseId' => $id, 'resolution' => 'Handled' );
		};
		$only = 'Only a supervisor or manager can do this in Crisis Mgmt.';
		// Accounts: owner, manager and supervisor have full access.
		foreach ( array( ACC_OWNER, ACC_MANAGER, ACC_SUP, ACC_ADMIN ) as $acc ) {
			has( array( 'ok' => true, 'applied' => true ), crisis_as( $acc, null, $close( $open() ) ), "account $acc closes" );
		}
		// A shared phone acts as the PIN person's job role: a desk officer (hdo) and department staff are "own".
		foreach ( array( MARIA, JOEL ) as $who ) {
			$c = id();
			has( array( 'ok' => true ), crisis_as( ACC_PHONE, $who, array( 'type' => 'logCrisis', 'caseId' => $c, 'code' => 'medical_emergency' ) ), "$who logs" );
			has( array( 'ok' => true ), crisis_as( ACC_PHONE, $who, array( 'type' => 'updateCrisis', 'caseId' => $c, 'text' => 'Nurse with the guest' ) ), "$who updates" );
			has( array( 'ok' => true ), crisis_as( ACC_PHONE, $who, array( 'type' => 'editCrisis', 'caseId' => $c, 'code' => 'medical_emergency', 'what' => 'Fainted' ) ), "$who edits" );
			has( array( 'ok' => true ), crisis_as( ACC_PHONE, $who, array( 'type' => 'monitorCrisis', 'caseId' => $c, 'text' => 'At the clinic' ) ), "$who monitors" );
			has( array( 'ok' => true ), crisis_as( ACC_PHONE, $who, array( 'type' => 'recordCrisis911', 'caseId' => $c, 'at' => '2027-01-15T08:00:00+08:00' ) ), "$who records 911" );
			$before = fingerprint();
			eq( array( 'ok' => false, 'error' => $only ), crisis_as( ACC_PHONE, $who, $close( $c ) ), "$who cannot close" );
			eq( $before, fingerprint(), 'the refused close changed nothing' );
			eq( 'monitoring', crisis_row( $c )['status'] );
			// A supervisor signs in with a PIN on the same phone and closes it; then the officer may reopen.
			has( array( 'ok' => true, 'applied' => true ), crisis_as( ACC_PHONE, LIZA, $close( $c ) ), 'supervisor PIN closes' );
			has( array( 'ok' => true ), crisis_as( ACC_PHONE, $who, array( 'type' => 'reopenCrisis', 'caseId' => $c ) ), "$who reopens" );
		}
		eq( array( 'ok' => false, 'error' => 'Sign in with your PIN first.' ), crisis_as( ACC_PHONE, null, array( 'type' => 'logCrisis', 'caseId' => id(), 'code' => 'fire' ) ), 'a shared phone with nobody signed in' );
		// The same rule as a safety alert today: an officer cannot resolve one either.
		$inc = id();
		cmd( array( 'type' => 'raiseSafety', 'incidentId' => $inc, 'room' => '510', 'text' => 'smoke', 'hazard' => 'smoke' ) );
		eq( array( 'ok' => false, 'error' => $only ), crisis_as( ACC_PHONE, MARIA, array( 'type' => 'resolveIncident', 'incidentId' => $inc ) ) );
	}
);

test(
	'crisis: the snapshot window: open and monitored cases always, closed ones for 30 days; counts; who may read the slice',
	function () {
		list( $old_open ) = crisis_log( array( 'code' => 'typhoon' ) );
		list( $old_mon )  = crisis_log( array( 'code' => 'power_outage' ) );
		cmd( array( 'type' => 'monitorCrisis', 'caseId' => $old_mon, 'text' => 'Generator on' ) );
		list( $old_closed ) = crisis_log( array( 'code' => 'fire' ) );
		cmd( array( 'type' => 'closeCrisis', 'caseId' => $old_closed, 'resolution' => 'Drill' ) );
		azl_advance( 31 * 86400000 );
		list( $recent_closed ) = crisis_log( array( 'code' => 'earthquake' ) );
		cmd( array( 'type' => 'closeCrisis', 'caseId' => $recent_closed, 'resolution' => 'No damage' ) );
		azl_advance( 60000 );
		list( $new ) = crisis_log( array( 'category' => 'billing' ) );
		$slice = crisis_slice();
		eq( array( $new, $recent_closed, $old_mon, $old_open ), array_column( $slice['cases'], 'id' ), 'newest first; the case closed 31 days ago is gone' );
		eq( array( 'active' => 2, 'monitoring' => 1, 'resolved' => 1, 'unresolved' => 3 ), $slice['counts'] );
		// Who reads it: everyone with access to Crisis Mgmt, department staff included ("own"); nobody else.
		ok( null !== crisis_slice( array( 'kind' => 'staff', 'dept' => 'housekeeping' ) ), 'department staff read the case log' );
		ok( null !== crisis_slice( array( 'kind' => 'hdo', 'dept' => 'frontdesk' ) ), 'desk officers read it' );
		eq( null, crisis_slice( array( 'kind' => 'none', 'dept' => null ) ), 'no slice without a person' );
	}
);

/**
 * The safety lane, start to finish: two reports cluster into one alert, a new one opens, 911 is recorded once, one
 * alert is downgraded and one resolved. Returns every answer and the incident rows and logs, without the time.
 */
function safety_scenario( array $ids ): array {
	$out   = array();
	$out[] = cmd( array( 'type' => 'raiseSafety', 'incidentId' => $ids[0], 'opId' => $ids[5], 'room' => '341', 'text' => 'smoke in the hall', 'hazard' => 'smoke' ) );
	azl_advance( 60000 );
	$out[] = cmd( array( 'type' => 'raiseSafety', 'incidentId' => $ids[1], 'opId' => $ids[6], 'room' => '342', 'text' => 'usok', 'hazard' => 'smoke' ) );
	$out[] = cmd( array( 'type' => 'raiseSafety', 'incidentId' => $ids[2], 'opId' => $ids[7], 'room' => '118', 'text' => 'hindi makahinga', 'hazard' => 'medical' ) );
	$out[] = cmd( array( 'type' => 'record911', 'incidentId' => $ids[0], 'opId' => $ids[8], 'at' => '2027-01-15T08:00:00+08:00' ) );
	$out[] = cmd( array( 'type' => 'record911', 'incidentId' => $ids[0], 'opId' => $ids[9], 'at' => '2027-01-15T08:01:00+08:00' ) );
	$out[] = cmd( array( 'type' => 'record911', 'incidentId' => $ids[0], 'opId' => $ids[8], 'at' => '2027-01-15T08:00:00+08:00' ) ); // replay
	$out[] = cmd( array( 'type' => 'downgradeIncident', 'incidentId' => $ids[2], 'opId' => $ids[10] ) );
	$out[] = cmd( array( 'type' => 'resolveIncident', 'incidentId' => $ids[0], 'opId' => $ids[11] ) );
	$out[] = cmd( array( 'type' => 'resolveIncident', 'incidentId' => $ids[0], 'opId' => id() ) );
	$rows  = Azl_Db::rows( 'SELECT id, inc_no, hazard, rooms, report, status, called911_by, called911_at, op_id FROM ' . Azl_Db::t( 'incidents' ) . ' ORDER BY inc_no' );
	$logs  = Azl_Db::rows( "SELECT entity_id, what, by_staff, op_id FROM " . Azl_Db::t( 'events' ) . " WHERE entity = 'incident' ORDER BY id" );
	$snap  = array_map(
		static function ( $i ) {
			unset( $i['createdAt'] );
			$i['log'] = array_map( fn( $l ) => array( $l['by'], $l['what'] ), $i['log'] );
			return $i;
		},
		Azl_Snapshot::load()['incidents']
	);
	return array( $out, $rows, $logs, $snap, Azl_Db::counter( 'inc' ) );
}

test(
	'crisis: the safety lane is untouched: alerts, clustering, 911 and sign-off answer and store exactly the same when cases exist',
	function () {
		$ids = array();
		for ( $i = 0; $i < 12; $i++ ) {
			$ids[] = id();
		}
		$without = safety_scenario( $ids );
		ok( 'Staff notified (not BFP/911).' === substr( Azl_Commands::ALERT, -29 ), 'the alert still names who was notified' );
		// Again on a fresh database that holds crisis cases, open and closed, one linked to an alert.
		azl_reset();
		seed_staff();
		$old = id();
		cmd( array( 'type' => 'raiseSafety', 'incidentId' => $old, 'room' => '900', 'text' => 'baha', 'hazard' => 'flood' ) );
		crisis_log( array( 'incidentId' => $old ) );
		list( $closed ) = crisis_log( array( 'code' => 'fire', 'what' => 'Drill' ) );
		cmd( array( 'type' => 'closeCrisis', 'caseId' => $closed, 'resolution' => 'Drill over' ) );
		crisis_log( array( 'category' => 'noise' ) );
		// The old alert is outside the cluster window and numbered first; drop it from the comparison by resetting it.
		azl_advance( 16 * 60000 );
		Azl_Db::exec( 'DELETE FROM ' . Azl_Db::t( 'incidents' ) . ' WHERE id = %s', array( $old ) );
		Azl_Db::exec( 'DELETE FROM ' . Azl_Db::t( 'events' ) . " WHERE entity = 'incident'" );
		Azl_Db::exec( 'UPDATE ' . Azl_Db::t( 'seq' ) . " SET val = 0 WHERE name = 'inc'" );
		Azl_Db::$clock = 1_800_000_000_000;
		$with = safety_scenario( $ids );
		eq( $without, $with, 'same answers, rows, logs, snapshot and numbers' );
		eq( 3, (int) Azl_Db::val( 'SELECT COUNT(*) FROM ' . Azl_Db::t( 'crisis_cases' ) ), 'and the cases are still there' );
	}
);
