<?php
/**
 * Azl_Commands: the port of src/server/mutations.test.ts, in spirit.
 */

/* ---------- logging and routing ---------- */

test(
	'logRequest routes each item to its department with the preset SLA',
	function () {
		list( $request, $items, $res ) = logged( '301', array( 'towels', 'ac', 'wifi', 'noise' ) );
		has( array( 'ok' => true, 'applied' => true, 'ticketNo' => 1 ), $res );
		has( array( 'name' => 'Extra towels', 'dept' => 'housekeeping', 'sla_min' => '10', 'status' => 'new', 'request_id' => $request ), item_row( $items[0] ) );
		has( array( 'name' => 'AC not cold', 'dept' => 'engineering', 'sla_min' => '45' ), item_row( $items[1] ) );
		has( array( 'name' => 'Wi-Fi issue', 'dept' => 'it', 'sla_min' => '20' ), item_row( $items[2] ) );
		has( array( 'name' => 'Noise complaint', 'dept' => 'security', 'sla_min' => '10' ), item_row( $items[3] ) );
		eq( array( 'Logged' ), labels( $items[0] ) );
		eq( array( 'Logged' ), labels( $request ) );
		$req = Azl_Db::row( 'SELECT room, logged_by, source, incomplete FROM ' . Azl_Db::t( 'requests' ) . ' WHERE id = %s', array( $request ) );
		eq( array( 'room' => '301', 'logged_by' => MARIA, 'source' => 'staff', 'incomplete' => '0' ), $req );
	}
);

test(
	"the leak bundle's clean-up waits for the fix",
	function () {
		list( , $items ) = logged( '303', array( 'towels' ), array( 'bundle' => 'leak' ) );
		has( array( 'name' => 'Leak: fix source', 'dept' => 'engineering', 'sla_min' => '20', 'depends_on' => null ), item_row( $items[1] ) );
		has( array( 'name' => 'Leak: clean up', 'dept' => 'housekeeping', 'sla_min' => '25', 'depends_on' => $items[1] ), item_row( $items[2] ) );
		eq( array( 'ok' => false, 'error' => 'Waiting for the earlier step to finish first.' ), cmd( array( 'type' => 'finish', 'itemId' => $items[2], 'status' => 'done' ) ) );
		has( array( 'ok' => true ), cmd( array( 'type' => 'finish', 'itemId' => $items[1], 'status' => 'done' ) ) );
		has( array( 'ok' => true ), cmd( array( 'type' => 'finish', 'itemId' => $items[2], 'status' => 'done' ) ) );
	}
);

test(
	'refusals write nothing: unknown preset, wrong item count, no room, bad id, unknown command',
	function () {
		$before = fingerprint();
		eq( array( 'ok' => false, 'error' => 'Unknown request type' ), cmd( array( 'type' => 'logRequest', 'requestId' => id(), 'itemIds' => array( id() ), 'room' => '304', 'presets' => array( 'caviar' ) ) ) );
		eq( array( 'ok' => false, 'error' => 'Item ids do not match the items' ), cmd( array( 'type' => 'logRequest', 'requestId' => id(), 'itemIds' => array(), 'room' => '304', 'presets' => array( 'towels' ) ) ) );
		eq( array( 'ok' => false, 'error' => 'Room is required' ), cmd( array( 'type' => 'logRequest', 'requestId' => id(), 'itemIds' => array( id() ), 'room' => '  ', 'presets' => array( 'towels' ) ) ) );
		eq( array( 'ok' => false, 'error' => 'Invalid id' ), cmd( array( 'type' => 'relay', 'itemId' => '1; drop table items' ) ) );
		eq( array( 'ok' => false, 'error' => 'Invalid id' ), cmd( array( 'type' => 'relay' ) ) );
		eq( array( 'ok' => false, 'error' => 'Unknown command' ), cmd( array( 'type' => 'dropTables' ) ) );
		eq( $before, fingerprint() );
	}
);

test(
	'log for later is incomplete until completeRequest adds the details',
	function () {
		list( $request ) = logged( '305', array(), array( 'later' => true ) );
		$item            = id();
		has( array( 'ok' => true, 'applied' => true ), cmd( array( 'type' => 'completeRequest', 'requestId' => $request, 'itemIds' => array( $item ), 'presets' => array( 'water' ) ) ) );
		eq( '0', Azl_Db::val( 'SELECT incomplete FROM ' . Azl_Db::t( 'requests' ) . ' WHERE id = %s', array( $request ) ) );
		eq( array( 'Details added' ), labels( $item ) );
		eq( array( 'ok' => false, 'error' => 'This request already has its details' ), cmd( array( 'type' => 'completeRequest', 'requestId' => $request, 'itemIds' => array( id() ), 'presets' => array( 'water' ) ) ) );
	}
);

/* ---------- ticket numbers ---------- */

test(
	'ticket numbers are sequential and gap-free across refusals, replays and a failed write',
	function () {
		$numbers = array();
		list( , , $a ) = logged( '311', array( 'towels' ) );
		$numbers[]      = $a['ticketNo'];
		cmd( array( 'type' => 'logRequest', 'requestId' => id(), 'itemIds' => array( id() ), 'room' => '311', 'presets' => array( 'caviar' ) ) ); // refused
		$c = array( 'type' => 'logRequest', 'opId' => id(), 'requestId' => id(), 'itemIds' => array( id() ), 'room' => '312', 'presets' => array( 'water' ) );
		$numbers[] = cmd( $c )['ticketNo'];
		eq( $numbers[1], cmd( $c )['ticketNo'], 'a replay answers with the same number' );
		// A write that fails after the counter moved (the item id is already taken) rolls the counter back.
		list( , $taken, $third ) = logged( '313', array( 'tv' ) );
		$numbers[]               = $third['ticketNo'];
		$failed          = cmd( array( 'type' => 'logRequest', 'requestId' => id(), 'itemIds' => array( $taken[0] ), 'room' => '314', 'presets' => array( 'tv' ) ) );
		eq( array( 'ok' => false, 'error' => 'Something went wrong. Try again.' ), $failed );
		list( , , $d ) = logged( '315', array( 'tv' ) );
		$numbers[]      = $d['ticketNo'];
		eq( array( 1, 2, 3, 4 ), $numbers );
		eq( array( '1', '2', '3', '4' ), array_column( Azl_Db::rows( 'SELECT ticket_no FROM ' . Azl_Db::t( 'requests' ) . ' ORDER BY ticket_no' ), 'ticket_no' ) );
		eq( 4, Azl_Db::counter( 'ticket' ) );
	}
);

/* ---------- item flow and the SLA clock ---------- */

test(
	'relay assigns the first on-shift staff of the department; hold stops the SLA clock',
	function () {
		list( , $items ) = logged( '321', array( 'ac' ) );
		$it              = $items[0];
		cmd( array( 'type' => 'relay', 'itemId' => $it ) );
		has( array( 'status' => 'relayed', 'assignee' => RAMON, 'ack_at' => (string) Azl_Db::now() ), item_row( $it ) );
		cmd( array( 'type' => 'onSite', 'itemId' => $it ) );
		azl_advance( 60000 );
		cmd( array( 'type' => 'hold', 'itemId' => $it, 'reason' => 'parts' ) );
		has( array( 'status' => 'on_hold', 'hold_reason' => 'parts', 'hold_since' => (string) Azl_Db::now() ), item_row( $it ) );
		azl_advance( 5 * 60000 );
		cmd( array( 'type' => 'resume', 'itemId' => $it ) );
		has( array( 'status' => 'on_site', 'held_ms' => '300000', 'hold_since' => null, 'hold_reason' => null ), item_row( $it ) );
		// A second hold that ends with the item closed while still on hold is added too.
		cmd( array( 'type' => 'hold', 'itemId' => $it, 'reason' => 'vendor' ) );
		azl_advance( 3 * 60000 );
		cmd( array( 'type' => 'finish', 'itemId' => $it, 'status' => 'cant_do' ) );
		has( array( 'status' => 'cant_do', 'held_ms' => '480000', 'hold_since' => null ), item_row( $it ) );
		eq( array( 'Logged', 'Relayed', 'On site', 'On hold', 'Resumed', 'On hold', "Can't do" ), labels( $it ) );
		$snap = Azl_Snapshot::load();
		eq( 480000, $snap['items']->$it['heldMs'] );
	}
);

test(
	'a step from the wrong status is refused with the TypeScript wording',
	function () {
		list( , $items ) = logged( '322', array( 'towels' ) );
		cmd( array( 'type' => 'relay', 'itemId' => $items[0] ) );
		eq( array( 'ok' => false, 'error' => 'Not possible while the item is relayed' ), cmd( array( 'type' => 'relay', 'itemId' => $items[0] ) ) );
		eq( array( 'ok' => false, 'error' => 'Not possible while the item is relayed' ), cmd( array( 'type' => 'resume', 'itemId' => $items[0] ) ) );
		eq( array( 'ok' => false, 'error' => 'Unknown hold reason' ), cmd( array( 'type' => 'hold', 'itemId' => $items[0], 'reason' => 'lunch' ) ) );
		eq( array( 'ok' => false, 'error' => 'Unknown item' ), cmd( array( 'type' => 'relay', 'itemId' => id() ) ) );
	}
);

test(
	"finishing an inspection readies that room's queued cleaning only",
	function () {
		$mine            = clean_task( '323', 'queued' );
		$other           = clean_task( '324', 'queued' );
		list( , $items ) = logged( '323', array( 'inspection' ) );
		cmd( array( 'type' => 'finish', 'itemId' => $items[0], 'status' => 'done' ) );
		eq( 'ready', Azl_Db::val( 'SELECT status FROM ' . Azl_Db::t( 'clean_tasks' ) . ' WHERE id = %s', array( $mine ) ) );
		eq( 'queued', Azl_Db::val( 'SELECT status FROM ' . Azl_Db::t( 'clean_tasks' ) . ' WHERE id = %s', array( $other ) ) );
	}
);

test(
	'transfer closes the original and opens a copy in the new department',
	function () {
		list( , $items ) = logged( '325', array( 'tv' ) );
		$copy            = id();
		has( array( 'ok' => true ), cmd( array( 'type' => 'transfer', 'itemId' => $items[0], 'newItemId' => $copy, 'dept' => 'engineering' ) ) );
		has( array( 'status' => 'transferred' ), item_row( $items[0] ) );
		has( array( 'name' => 'TV not working', 'dept' => 'engineering', 'status' => 'new', 'x_from' => $items[0], 'assignee' => null ), item_row( $copy ) );
		eq( array( 'Logged', 'Transferred to engineering' ), labels( $items[0] ) );
		eq( array( 'Transferred in' ), labels( $copy ) );
		eq( array( 'ok' => false, 'error' => 'The item is already with that department' ), cmd( array( 'type' => 'transfer', 'itemId' => $copy, 'newItemId' => id(), 'dept' => 'engineering' ) ) );
	}
);

/* ---------- work orders ---------- */

test(
	'escalate, undo, escalate again, assess, start and complete closes the item',
	function () {
		$it  = on_site_ac( '331' );
		$wo  = id();
		$res = cmd( array( 'type' => 'escalate', 'itemId' => $it, 'woId' => $wo ) );
		eq( array( 'ok' => true, 'applied' => true, 'woNo' => 1 ), $res );
		has( array( 'status' => 'escalated', 'wo_id' => $wo, 'st_before_esc' => 'on_site' ), item_row( $it ) );
		has( array( 'descr' => 'AC not cold (from T-0001)', 'loc' => 'Room 331', 'reported_by' => MARIA ), Azl_Db::row( 'SELECT * FROM ' . Azl_Db::t( 'work_orders' ) . ' WHERE id = %s', array( $wo ) ) );
		cmd( array( 'type' => 'undoEscalate', 'itemId' => $it ) );
		has( array( 'status' => 'on_site', 'wo_id' => null ), item_row( $it ) );
		eq( null, Azl_Db::val( 'SELECT id FROM ' . Azl_Db::t( 'work_orders' ) . ' WHERE id = %s', array( $wo ) ) );
		$wo2 = id();
		eq( 2, cmd( array( 'type' => 'escalate', 'itemId' => $it, 'woId' => $wo2 ) )['woNo'] );
		eq( array( 'ok' => false, 'error' => 'Enter a cost of zero or more' ), cmd( array( 'type' => 'assessWo', 'woId' => $wo2, 'assessment' => 'x', 'assignType' => 'inhouse', 'estCost' => -1 ) ) );
		eq( array( 'ok' => false, 'error' => 'Enter a cost of zero or more' ), cmd( array( 'type' => 'assessWo', 'woId' => $wo2, 'assessment' => 'x', 'assignType' => 'inhouse', 'estCost' => '5' ) ) );
		has( array( 'ok' => true ), cmd( array( 'type' => 'assessWo', 'woId' => $wo2, 'assessment' => ' Compressor ', 'assignType' => 'inhouse', 'estCost' => 1200 ) ) );
		has( array( 'ok' => true ), cmd( array( 'type' => 'startWo', 'woId' => $wo2 ) ) );
		has( array( 'ok' => true ), cmd( array( 'type' => 'completeWo', 'woId' => $wo2, 'actualCost' => 1100.5 ) ) );
		has( array( 'status' => 'done' ), item_row( $it ) );
		ok( in_array( 'Closed by WO-0002', labels( $it ), true ), 'item log names the work order' );
		eq( array( 'Escalated from request', 'Assessed', 'Work started', 'Completed' ), labels( $wo2 ) );
		$snap = Azl_Snapshot::load();
		has( array( 'no' => 'WO-0002', 'status' => 'done', 'assessment' => 'Compressor', 'estCost' => 1200.0, 'actualCost' => 1100.5, 'srcItemId' => $it ), $snap['wos'][0] );
	}
);

test(
	'only on-site engineering or IT items escalate',
	function () {
		$error             = 'Only on-site Engineering or IT items can become work orders.';
		list( , $towels )  = logged( '332', array( 'towels' ) );
		cmd( array( 'type' => 'onSite', 'itemId' => $towels[0] ) );
		list( , $ac )      = logged( '332', array( 'ac' ) );
		eq( array( 'ok' => false, 'error' => $error ), cmd( array( 'type' => 'escalate', 'itemId' => $towels[0], 'woId' => id() ) ) );
		eq( array( 'ok' => false, 'error' => $error ), cmd( array( 'type' => 'escalate', 'itemId' => $ac[0], 'woId' => id() ) ) );
	}
);

/* ---------- safety ---------- */

test(
	'a second report from another room merges into the active incident; the same room opens a new one',
	function () {
		$first = id();
		$a     = cmd( array( 'type' => 'raiseSafety', 'incidentId' => $first, 'room' => '341', 'text' => 'smoke', 'hazard' => 'smoke' ) );
		eq( array( 'ok' => true, 'applied' => true, 'incidentNo' => 1 ), $a );
		azl_advance( 60000 );
		$b = cmd( array( 'type' => 'raiseSafety', 'incidentId' => id(), 'room' => '342', 'text' => 'usok', 'hazard' => 'smoke' ) );
		eq( array( 'ok' => true, 'applied' => true, 'clusteredInto' => $first, 'incidentNo' => 1 ), $b );
		$c = cmd( array( 'type' => 'raiseSafety', 'incidentId' => id(), 'room' => '341', 'text' => 'smoke again', 'hazard' => 'smoke' ) );
		eq( array( 'ok' => true, 'applied' => true, 'incidentNo' => 2 ), $c );
		eq( '["341","342"]', Azl_Db::val( 'SELECT rooms FROM ' . Azl_Db::t( 'incidents' ) . ' WHERE id = %s', array( $first ) ) );
		eq( array( Azl_Commands::ALERT, 'Second report from room 342: treated as one incident' ), labels( $first ) );
		// Outside the 15-minute window a report starts a new incident.
		azl_advance( 16 * 60000 );
		eq( 3, cmd( array( 'type' => 'raiseSafety', 'incidentId' => id(), 'room' => '343', 'text' => 'fire', 'hazard' => 'smoke' ) )['incidentNo'] );
	}
);

test(
	'the 911 call is recorded once, by name, or as "a manager"',
	function () {
		$inc = id();
		cmd( array( 'type' => 'raiseSafety', 'incidentId' => $inc, 'room' => '344', 'text' => 'gas leak', 'hazard' => 'gas' ) );
		eq( array( 'ok' => false, 'error' => 'The call time is not a valid date' ), cmd( array( 'type' => 'record911', 'incidentId' => $inc, 'at' => 'not a date' ) ) );
		eq( array( 'ok' => false, 'error' => 'The call time is not a valid date' ), cmd( array( 'type' => 'record911', 'incidentId' => $inc, 'at' => 'now' ) ) );
		$at = '2026-10-27T10:00:00.000Z';
		eq( array( 'ok' => true, 'applied' => true ), cmd( array( 'type' => 'record911', 'incidentId' => $inc, 'at' => $at ) ) );
		$before = fingerprint();
		eq( array( 'ok' => false, 'error' => 'The 911 call is already recorded for this incident' ), cmd( array( 'type' => 'record911', 'incidentId' => $inc, 'at' => '2026-10-27T10:05:00.000Z' ), null ) );
		eq( $before, fingerprint(), 'the refused second call left no trace' );
		ok( in_array( "BFP/911 called at $at", labels( $inc ), true ), 'the call is in the incident log' );
		$snap = Azl_Snapshot::load();
		eq( array( 'by' => 'Maria Santos', 'at' => $at ), $snap['incidents'][0]['called911'] );

		$other = id();
		cmd( array( 'type' => 'raiseSafety', 'incidentId' => $other, 'room' => '345', 'text' => 'baha', 'hazard' => 'flood' ) );
		cmd( array( 'type' => 'record911', 'incidentId' => $other, 'at' => '2026-10-27T11:05:00+08:00' ), null );
		$snap = Azl_Snapshot::load();
		$mine = array_values( array_filter( $snap['incidents'], fn( $i ) => $i['id'] === $other ) )[0];
		eq( array( 'by' => 'a manager', 'at' => '2026-10-27T03:05:00.000Z' ), $mine['called911'] );
	}
);

test(
	'the 911 guard holds even when the row was read before another call landed',
	function () {
		$inc = id();
		cmd( array( 'type' => 'raiseSafety', 'incidentId' => $inc, 'room' => '346', 'text' => 'fire', 'hazard' => 'smoke' ) );
		// Simulate the race the row lock prevents on MySQL: the call is recorded behind our back.
		Azl_Db::exec( 'UPDATE ' . Azl_Db::t( 'incidents' ) . ' SET called911_at = 1 WHERE id = %s', array( $inc ) );
		eq( array( 'ok' => false, 'error' => Azl_Commands::LOCKED_911 ), cmd( array( 'type' => 'record911', 'incidentId' => $inc, 'at' => '2026-10-27T10:00:00Z' ) ) );
	}
);

test(
	'downgrade and resolve only an active incident',
	function () {
		$inc = id();
		cmd( array( 'type' => 'raiseSafety', 'incidentId' => $inc, 'room' => '347', 'text' => 'stuck', 'hazard' => 'lift' ) );
		has( array( 'ok' => true ), cmd( array( 'type' => 'downgradeIncident', 'incidentId' => $inc ) ) );
		eq( array( 'ok' => false, 'error' => 'This incident is no longer active' ), cmd( array( 'type' => 'resolveIncident', 'incidentId' => $inc ) ) );
	}
);

/* ---------- handover ---------- */

test(
	'handover sign-off records the acting staff member, or "a manager"',
	function () {
		$h = id();
		eq( array( 'ok' => true, 'applied' => true ), cmd( array( 'type' => 'ackHandover', 'handoverId' => $h, 'note' => '  Pool light still out  ' ) ) );
		eq( array( 'signed_by' => MARIA, 'note' => 'Pool light still out' ), Azl_Db::row( 'SELECT signed_by, note FROM ' . Azl_Db::t( 'handovers' ) . ' WHERE id = %s', array( $h ) ) );
		eq( array( 'Handover acknowledged' ), labels( $h ) );
		eq( array( 'ackBy' => 'Maria Santos', 'ackAt' => Azl_Db::now() ), Azl_Snapshot::load()['handover'] );
		azl_advance( 1000 );
		cmd( array( 'type' => 'ackHandover', 'handoverId' => id() ), null );
		has( array( 'ackBy' => 'a manager' ), Azl_Snapshot::load()['handover'] );
	}
);

test(
	'handover refuses a long note or a reused id and writes nothing',
	function () {
		$before = fingerprint();
		eq( array( 'ok' => false, 'error' => 'Keep the note under 1000 characters' ), cmd( array( 'type' => 'ackHandover', 'handoverId' => id(), 'note' => str_repeat( 'x', 1001 ) ) ) );
		eq( array( 'ok' => false, 'error' => 'The note must be text' ), cmd( array( 'type' => 'ackHandover', 'handoverId' => id(), 'note' => 5 ) ) );
		eq( $before, fingerprint() );
		$h = id();
		cmd( array( 'type' => 'ackHandover', 'handoverId' => $h ) );
		$after = fingerprint();
		eq( array( 'ok' => false, 'error' => 'This handover is already signed off' ), cmd( array( 'type' => 'ackHandover', 'handoverId' => $h ) ) );
		eq( $after, fingerprint() );
	}
);

/** An open item assigned straight to $who, as if relayed before they went off shift. */
function assigned_to( string $room, string $who ): string {
	list( , $items ) = logged( $room, array( 'ac' ) );
	cmd( array( 'type' => 'relay', 'itemId' => $items[0] ) );
	Azl_Db::update( 'items', array( 'assignee' => $who ), array( 'id' => $items[0] ) );
	return $items[0];
}

test(
	'returnOrphans puts off-shift work back in the department queue and keeps covered work',
	function () {
		$a    = assigned_to( '351', DENNIS );
		$b    = assigned_to( '352', DENNIS );
		$kept = assigned_to( '353', RAMON );
		eq( array( 'ok' => true, 'applied' => true ), cmd( array( 'type' => 'returnOrphans', 'itemIds' => array( $a, $b, $kept ) ) ) );
		foreach ( array( $a, $b ) as $it ) {
			has( array( 'status' => 'relayed', 'assignee' => null ), item_row( $it ) );
			eq( array( 'Logged', 'Relayed', 'Returned to department queue at shift end' ), labels( $it ) );
		}
		has( array( 'assignee' => RAMON ), item_row( $kept ) );
		ok( ! isset( Azl_Snapshot::load()['items']->$a['assignee'] ), 'the snapshot leaves out the cleared assignee' );
		$before = fingerprint();
		eq( array( 'ok' => false, 'error' => 'Nothing to return. These items already have someone on shift.' ), cmd( array( 'type' => 'returnOrphans', 'itemIds' => array( $kept ) ) ) );
		eq( array( 'ok' => false, 'error' => 'Unknown item' ), cmd( array( 'type' => 'returnOrphans', 'itemIds' => array( $kept, id() ) ) ) );
		eq( array( 'ok' => false, 'error' => 'Choose the items to return' ), cmd( array( 'type' => 'returnOrphans', 'itemIds' => array( $kept, $kept ) ) ) );
		eq( array( 'ok' => false, 'error' => 'Choose the items to return' ), cmd( array( 'type' => 'returnOrphans', 'itemIds' => array() ) ) );
		eq( array( 'ok' => false, 'error' => 'Invalid id' ), cmd( array( 'type' => 'returnOrphans', 'itemIds' => array( 'not-a-uuid' ) ) ) );
		eq( $before, fingerprint() );
	}
);

/* ---------- the acting staff member ---------- */

test(
	'a command from a deactivated staff member is refused and writes nothing',
	function () {
		Azl_Db::update( 'staff', array( 'active' => 0 ), array( 'id' => JOEL ) );
		$before = fingerprint();
		eq( array( 'ok' => false, 'error' => Azl_Commands::NOT_HERE ), cmd( array( 'type' => 'logRequest', 'requestId' => id(), 'itemIds' => array( id() ), 'room' => '361', 'presets' => array( 'towels' ) ), JOEL ) );
		eq( array( 'ok' => false, 'error' => Azl_Commands::NOT_HERE ), cmd( array( 'type' => 'ackHandover', 'handoverId' => id() ), id() ) );
		eq( $before, fingerprint() );
	}
);

/* ---------- idempotent replay ---------- */

test(
	'replaying any command with the same op id changes nothing',
	function () {
		$request         = id();
		list( $first, $again ) = twice( array( 'type' => 'logRequest', 'requestId' => $request, 'itemIds' => array( id() ), 'room' => '371', 'presets' => array( 'towels' ), 'later' => true ) );
		eq( $first['ticketNo'], $again['ticketNo'] );
		twice( array( 'type' => 'completeRequest', 'requestId' => $request, 'itemIds' => array( id() ), 'presets' => array( 'water' ) ) );

		list( , $items ) = logged( '372', array( 'ac' ) );
		$it              = $items[0];
		twice( array( 'type' => 'relay', 'itemId' => $it ) );
		twice( array( 'type' => 'onSite', 'itemId' => $it ) );
		twice( array( 'type' => 'hold', 'itemId' => $it, 'reason' => 'parts' ) );
		twice( array( 'type' => 'resume', 'itemId' => $it ) );
		$wo                    = id();
		list( $first, $again ) = twice( array( 'type' => 'escalate', 'itemId' => $it, 'woId' => $wo ) );
		eq( $first['woNo'], $again['woNo'] );
		twice( array( 'type' => 'assessWo', 'woId' => $wo, 'assessment' => 'Fan', 'assignType' => 'outsource', 'contractor' => 'Coolfix', 'estCost' => 0 ) );
		twice( array( 'type' => 'startWo', 'woId' => $wo ) );
		twice( array( 'type' => 'holdWo', 'woId' => $wo ) );
		twice( array( 'type' => 'completeWo', 'woId' => $wo, 'actualCost' => 10 ) );
		twice( array( 'type' => 'reopenWo', 'woId' => $wo ) );

		list( , $more ) = logged( '373', array( 'tv', 'towels' ) );
		twice( array( 'type' => 'transfer', 'itemId' => $more[0], 'newItemId' => id(), 'dept' => 'engineering' ) );
		twice( array( 'type' => 'finish', 'itemId' => $more[1], 'status' => 'done' ) );
		twice( array( 'type' => 'cleanSet', 'taskId' => clean_task( '374', 'scheduled' ), 'status' => 'done' ) );

		$inc                   = id();
		list( $first, $again ) = twice( array( 'type' => 'raiseSafety', 'incidentId' => $inc, 'room' => '375', 'text' => 'baha', 'hazard' => 'flood' ) );
		eq( $first['incidentNo'], $again['incidentNo'] );
		list( , $merged ) = twice( array( 'type' => 'raiseSafety', 'incidentId' => id(), 'room' => '376', 'text' => 'baha', 'hazard' => 'flood' ) );
		eq( array( 'ok' => true, 'applied' => false, 'incidentNo' => $first['incidentNo'], 'clusteredInto' => $inc ), $merged );
		twice( array( 'type' => 'record911', 'incidentId' => $inc, 'at' => '2026-10-27T10:00:00.000Z' ) );
		twice( array( 'type' => 'downgradeIncident', 'incidentId' => $inc ) );
		twice( array( 'type' => 'ackHandover', 'handoverId' => id() ) );
		twice( array( 'type' => 'returnOrphans', 'itemIds' => array( assigned_to( '377', DENNIS ) ) ) );
		eq( 1, (int) Azl_Db::val( 'SELECT COUNT(*) FROM ' . Azl_Db::t( 'handovers' ) ) );
	}
);

test(
	'every applied command moves the change counter once; refusals and replays do not',
	function () {
		$rev = Azl_Db::counter( 'change' );
		$c   = array( 'type' => 'logRequest', 'opId' => id(), 'requestId' => id(), 'itemIds' => array( id() ), 'room' => '381', 'presets' => array( 'towels' ) );
		cmd( $c );
		eq( $rev + 1, Azl_Db::counter( 'change' ) );
		cmd( $c );
		cmd( array( 'type' => 'relay', 'itemId' => id() ) );
		eq( $rev + 1, Azl_Db::counter( 'change' ) );
	}
);
