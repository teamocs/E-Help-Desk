<?php
/**
 * Requests parity (wave 2): New Request rows (Other items, qty, assignee), staff requests and the HDO, Edit ticket,
 * Edit item, Hand Off, undoStep and its rules, the change history, the snapshot fields, who may do what, and the
 * schema 3 upgrade of a database that already holds version 2 rows.
 */

const RQ_ANA = 'a0a0a0a0-0000-4000-8000-000000000106'; // supervisor, no department: may be an HDO

function rq_ana(): void {
	Azl_Db::insert( 'staff', array( 'id' => RQ_ANA, 'name' => 'Ana Villanueva', 'initials' => 'AV', 'role' => 'supervisor', 'title' => 'Duty Manager', 'dept' => null, 'on_shift' => 1, 'active' => 1, 'pin_failed' => 0, 'created_at' => 9, 'updated_at' => 9 ) );
}

/** A request logged with New Request rows. @return array{0: string, 1: string[], 2: array} */
function rq_log( array $rows, array $extra = array(), ?string $actor = MARIA ): array {
	$request = id();
	$items   = array_map( fn() => id(), $rows );
	$res     = cmd( array( 'type' => 'logRequest', 'requestId' => $request, 'itemIds' => $items, 'room' => '601', 'rows' => $rows ) + $extra, $actor );
	return array( $request, $items, $res );
}

function rq_req( string $id ): array {
	return Azl_Db::row( 'SELECT * FROM ' . Azl_Db::t( 'requests' ) . ' WHERE id = %s', array( $id ) );
}

/** Runs a command as a given actor kind (a shared phone's PIN person), like Azl_Access::who would say. */
function rq_as( array $c, string $actor, string $kind, ?string $dept ): array {
	return Azl_Commands::apply( $c + array( 'opId' => id() ), $actor, array( 'kind' => $kind, 'dept' => $dept ) );
}

/** One towels item taken to $status the normal way, each step one second apart. */
function rq_item( string $status ): string {
	list( , $items ) = logged( '602', array( 'towels' ) );
	$it              = $items[0];
	$steps           = array(
		'relayed' => array( array( 'type' => 'relay' ) ),
		'on_site' => array( array( 'type' => 'relay' ), array( 'type' => 'onSite' ) ),
		'on_hold' => array( array( 'type' => 'relay' ), array( 'type' => 'onSite' ), array( 'type' => 'hold', 'reason' => 'dnd' ) ),
		'done'    => array( array( 'type' => 'relay' ), array( 'type' => 'onSite' ), array( 'type' => 'finish', 'status' => 'done' ) ),
	);
	foreach ( $steps[ $status ] ?? array() as $s ) {
		azl_advance( 1000 );
		has( array( 'ok' => true ), cmd( $s + array( 'itemId' => $it ) ), $s['type'] );
	}
	return $it;
}

/* ---------- New Request: rows, Other, qty, assignee, staff request, HDO ---------- */

test(
	'requests: New Request rows log catalog and Other items with qty and an assignee; the HDO defaults to the person logging',
	function () {
		list( $request, $items, $res ) = rq_log(
			array(
				array( 'type' => 'towels', 'qty' => 3, 'assignee' => JOEL ),
				array( 'other' => '  Extra hangers ', 'dept' => 'housekeeping' ),
			),
			array( 'source' => 'guest' )
		);
		has( array( 'ok' => true, 'applied' => true, 'ticketNo' => 1 ), $res );
		has( array( 'name' => 'Extra towels', 'qty' => '3', 'assignee' => JOEL, 'sla_min' => '10', 'status' => 'new', 'pos' => '0' ), item_row( $items[0] ) );
		has( array( 'name' => 'Extra hangers', 'qty' => '1', 'assignee' => null, 'dept' => 'housekeeping', 'sla_min' => (string) Azl_Commands::OTHER_SLA_MIN, 'pos' => '1' ), item_row( $items[1] ) );
		has( array( 'source' => 'guest', 'staff_name' => null, 'hdo' => MARIA, 'logged_by' => MARIA ), rq_req( $request ) );
		// Relay keeps the person assigned at creation.
		cmd( array( 'type' => 'relay', 'itemId' => $items[0] ) );
		has( array( 'assignee' => JOEL, 'relayed_by' => MARIA, 'prev_status' => 'new' ), item_row( $items[0] ) );
	}
);

test(
	'requests: a staff request names the staff member; an HDO can be chosen; a manager account logs with no HDO',
	function () {
		rq_ana();
		list( $request ) = rq_log( array( array( 'type' => 'tv' ) ), array( 'source' => 'staff_request', 'staffName' => ' Dela Cruz, Maria ', 'hdoId' => RQ_ANA ) );
		has( array( 'source' => 'staff_request', 'staff_name' => 'Dela Cruz, Maria', 'hdo' => RQ_ANA ), rq_req( $request ) );
		list( $other ) = rq_log( array( array( 'type' => 'tv' ) ), array(), null );
		has( array( 'source' => 'staff', 'hdo' => null, 'logged_by' => null ), rq_req( $other ) );
		$snap = Azl_Snapshot::load();
		$mine = array_values( array_filter( $snap['requests'], fn( $r ) => $r['id'] === $request ) )[0];
		has( array( 'source' => 'staff_request', 'staffName' => 'Dela Cruz, Maria', 'hdo' => RQ_ANA ), $mine );
	}
);

test(
	'requests: every New Request refusal is checked before any write',
	function () {
		$before = fingerprint();
		$bad    = array(
			array( array( array( 'type' => 'caviar' ) ), array(), 'Unknown request type' ),
			array( array( array( 'other' => '  ', 'dept' => 'it' ) ), array(), 'Describe the item' ),
			array( array( array( 'other' => 'Hangers' ) ), array(), 'Choose a department for the item' ),
			array( array( array( 'other' => 'Hangers', 'dept' => 'spa' ) ), array(), 'Choose a department for the item' ),
			array( array( array( 'other' => str_repeat( 'x', 121 ), 'dept' => 'it' ) ), array(), 'Keep the item under 120 characters' ),
			array( array( array( 'type' => 'towels', 'qty' => 0 ) ), array(), 'Quantity must be 1 to 99' ),
			array( array( array( 'type' => 'towels', 'qty' => 100 ) ), array(), 'Quantity must be 1 to 99' ),
			array( array( array( 'type' => 'towels', 'qty' => '2' ) ), array(), 'Quantity must be 1 to 99' ),
			array( array( array( 'type' => 'towels', 'assignee' => RAMON ) ), array(), "Assign someone from the item's department" ),
			array( array( array( 'type' => 'towels', 'assignee' => 'nobody' ) ), array(), "Assign someone from the item's department" ),
			array( array( array( 'type' => 'towels' ) ), array( 'source' => 'vendor' ), 'Unknown source' ),
			array( array( array( 'type' => 'towels' ) ), array( 'source' => 'staff_request' ), "Enter the staff member's name" ),
			array( array( array( 'type' => 'towels' ) ), array( 'hdoId' => JOEL ), 'Choose a help-desk officer from the list' ),
			array( array( array( 'type' => 'towels' ) ), array( 'hdoId' => id() ), 'Choose a help-desk officer from the list' ),
			array( array( array( 'type' => 'towels' ) ), array( 'presets' => array( 'water' ) ), 'Send rows or presets, not both' ),
			array( 'not a list', array(), 'Add up to 20 items' ),
		);
		foreach ( $bad as list( $rows, $extra, $error ) ) {
			$res = cmd( array( 'type' => 'logRequest', 'requestId' => id(), 'itemIds' => is_array( $rows ) ? array_map( fn() => id(), $rows ) : array(), 'room' => '603', 'rows' => $rows ) + $extra );
			eq( array( 'ok' => false, 'error' => $error ), $res, $error );
		}
		eq( array( 'ok' => false, 'error' => 'Item ids do not match the items' ), cmd( array( 'type' => 'logRequest', 'requestId' => id(), 'itemIds' => array( id() ), 'room' => '603', 'rows' => array( array( 'type' => 'towels' ), array( 'type' => 'water' ) ) ) ) );
		eq( $before, fingerprint() );
		eq( 0, Azl_Db::counter( 'ticket' ), 'no ticket number used' );
	}
);

test(
	'requests: rows plus a bundle; completeRequest takes rows too; both replay without a second write',
	function () {
		list( , $items, $res ) = rq_log( array( array( 'type' => 'towels', 'qty' => 2 ), array( 'type' => 'water' ) ), array( 'bundle' => 'leak' ) ) + array( 1 => array() );
		eq( 'Item ids do not match the items', $res['error'], 'a bundle adds its parts after the rows' );
		$request = id();
		$ids     = array( id(), id(), id(), id() );
		has( array( 'ok' => true ), cmd( array( 'type' => 'logRequest', 'requestId' => $request, 'itemIds' => $ids, 'room' => '604', 'rows' => array( array( 'type' => 'towels', 'qty' => 2 ), array( 'type' => 'water' ) ), 'bundle' => 'leak' ) ) );
		has( array( 'name' => 'Leak: clean up', 'depends_on' => $ids[2] ), item_row( $ids[3] ) );
		list( $later ) = logged( '605', array(), array( 'later' => true ) );
		$item          = id();
		twice( array( 'type' => 'completeRequest', 'requestId' => $later, 'itemIds' => array( $item ), 'rows' => array( array( 'other' => 'Umbrella', 'dept' => 'frontdesk', 'qty' => 2 ) ) ) );
		has( array( 'name' => 'Umbrella', 'qty' => '2', 'dept' => 'frontdesk' ), item_row( $item ) );
		twice( array( 'type' => 'logRequest', 'requestId' => id(), 'itemIds' => array( id() ), 'room' => '606', 'rows' => array( array( 'other' => 'Ice', 'dept' => 'fnb' ) ), 'source' => 'staff_request', 'staffName' => 'Lynette, HK' ) );
	}
);

/* ---------- Edit ticket and Edit item: change history ---------- */

test(
	'requests: Edit ticket changes only what was sent and writes one history line per change, old to new',
	function () {
		rq_ana();
		list( $request ) = rq_log( array( array( 'type' => 'towels' ) ), array( 'source' => 'guest', 'remarks' => 'Guest urgent' ) );
		azl_advance( 60000 );
		has( array( 'ok' => true, 'applied' => true ), cmd( array( 'type' => 'editRequest', 'requestId' => $request, 'room' => '414', 'vip' => true, 'source' => 'staff_request', 'staffName' => 'Lynette, HK', 'hdoId' => RQ_ANA, 'remarks' => 'Guest urgent' ) ) );
		has( array( 'room' => '414', 'vip' => '1', 'source' => 'staff_request', 'staff_name' => 'Lynette, HK', 'hdo' => RQ_ANA, 'remarks' => 'Guest urgent' ), rq_req( $request ) );
		eq( array( 'Logged', 'Room: 601 → 414', 'VIP: no → yes', 'Requested by: Guest → Staff (Lynette, HK)', 'HDO: Maria Santos → Ana Villanueva' ), labels( $request ) );
		$snap = Azl_Snapshot::load();
		$ev   = $snap['requests'][0]['events'];
		eq( array( 'at' => Azl_Db::now(), 'by' => MARIA, 'what' => 'Room: 601 → 414' ), $ev[1], 'who and when' );
		// Nothing changed: refused, nothing written.
		$before = fingerprint();
		eq( array( 'ok' => false, 'error' => 'Nothing changed' ), cmd( array( 'type' => 'editRequest', 'requestId' => $request, 'room' => '414' ) ) );
		eq( array( 'ok' => false, 'error' => 'Room is required' ), cmd( array( 'type' => 'editRequest', 'requestId' => $request, 'room' => ' ' ) ) );
		eq( array( 'ok' => false, 'error' => 'VIP must be yes or no' ), cmd( array( 'type' => 'editRequest', 'requestId' => $request, 'vip' => 1 ) ) );
		eq( array( 'ok' => false, 'error' => 'Choose a help-desk officer from the list' ), cmd( array( 'type' => 'editRequest', 'requestId' => $request, 'hdoId' => RAMON ) ) );
		eq( array( 'ok' => false, 'error' => 'Unknown request' ), cmd( array( 'type' => 'editRequest', 'requestId' => id(), 'room' => '1' ) ) );
		eq( $before, fingerprint() );
		// Long remarks are cut in the history line, never in the record.
		$long = str_repeat( 'a', 90 );
		twice( array( 'type' => 'editRequest', 'requestId' => $request, 'remarks' => $long, 'source' => 'guest' ) );
		eq( $long, rq_req( $request )['remarks'] );
		ok( in_array( 'Remarks: Guest urgent → ' . str_repeat( 'a', 69 ) . '…', labels( $request ), true ), 'cut remark line' );
		ok( in_array( 'Requested by: Staff (Lynette, HK) → Guest', labels( $request ), true ), 'back to guest' );
		eq( null, rq_req( $request )['staff_name'] );
	}
);

test(
	'requests: Edit item: name, qty, assignee, remarks; department only while new; a matching type sets the target time',
	function () {
		list( , $items ) = rq_log( array( array( 'type' => 'towels' ) ) );
		$it              = $items[0];
		twice( array( 'type' => 'editItem', 'itemId' => $it, 'qty' => 4, 'assignee' => JOEL, 'remarks' => 'Bath towels only' ) );
		has( array( 'qty' => '4', 'assignee' => JOEL, 'remarks' => 'Bath towels only' ), item_row( $it ) );
		eq( array( 'Logged', 'Qty: 1 → 4', 'Assigned: — → Joel Dizon', 'Remarks: — → Bath towels only' ), labels( $it ) );
		has( array( 'ok' => true ), cmd( array( 'type' => 'editItem', 'itemId' => $it, 'dept' => 'engineering', 'name' => 'AC not cold' ) ) );
		has( array( 'dept' => 'engineering', 'name' => 'AC not cold', 'assignee' => null, 'sla_min' => '45' ), item_row( $it ) );
		ok( in_array( 'Department: Housekeeping → Engineering', labels( $it ), true ), 'department line' );
		ok( in_array( 'Assigned: Joel Dizon → —', labels( $it ), true ), 'a new department drops the old assignee' );
		cmd( array( 'type' => 'relay', 'itemId' => $it ) );
		$before = fingerprint();
		eq( array( 'ok' => false, 'error' => 'Use Transfer to move a started item to another department' ), cmd( array( 'type' => 'editItem', 'itemId' => $it, 'dept' => 'it' ) ) );
		eq( array( 'ok' => false, 'error' => "Assign someone from the item's department" ), cmd( array( 'type' => 'editItem', 'itemId' => $it, 'assignee' => JOEL ) ) );
		eq( array( 'ok' => false, 'error' => 'Quantity must be 1 to 99' ), cmd( array( 'type' => 'editItem', 'itemId' => $it, 'qty' => 0 ) ) );
		eq( array( 'ok' => false, 'error' => 'Describe the item' ), cmd( array( 'type' => 'editItem', 'itemId' => $it, 'name' => '' ) ) );
		eq( array( 'ok' => false, 'error' => 'Nothing changed' ), cmd( array( 'type' => 'editItem', 'itemId' => $it, 'qty' => 4 ) ) );
		eq( array( 'ok' => false, 'error' => 'Unknown item' ), cmd( array( 'type' => 'editItem', 'itemId' => id(), 'qty' => 2 ) ) );
		eq( $before, fingerprint() );
		cmd( array( 'type' => 'transfer', 'itemId' => $it, 'newItemId' => id(), 'dept' => 'it' ) );
		eq( array( 'ok' => false, 'error' => 'Not possible while the item is transferred' ), cmd( array( 'type' => 'editItem', 'itemId' => $it, 'qty' => 2 ) ) );
		// A done item: corrections only, no new assignee.
		$done = rq_item( 'done' );
		has( array( 'ok' => true ), cmd( array( 'type' => 'editItem', 'itemId' => $done, 'qty' => 2 ) ) );
		eq( array( 'ok' => false, 'error' => 'Only an open item can be assigned' ), cmd( array( 'type' => 'editItem', 'itemId' => $done, 'assignee' => null ) ) );
	}
);

/* ---------- Hand Off ---------- */

test(
	'requests: Hand Off makes a follow-up item for a department and person, records who handed to whom, and keeps the done item',
	function () {
		$done = rq_item( 'done' );
		$next = id();
		twice( array( 'type' => 'handOff', 'itemId' => $done, 'newItemId' => $next, 'dept' => 'engineering', 'name' => 'AC not cold', 'assignee' => RAMON, 'note' => ' Guest says it drips ' ) );
		has( array( 'status' => 'done' ), item_row( $done ) );
		has( array( 'name' => 'AC not cold', 'dept' => 'engineering', 'assignee' => RAMON, 'status' => 'new', 'x_from' => $done, 'x_kind' => 'handoff', 'x_note' => 'Guest says it drips', 'sla_min' => '45', 'pos' => '1' ), item_row( $next ) );
		eq( 'Handed off to Engineering (Ramon Cruz): Guest says it drips', array_slice( labels( $done ), -1 )[0] );
		eq( array( 'Follow-up of Extra towels' ), labels( $next ) );
		$by = Azl_Db::val( 'SELECT by_staff FROM ' . Azl_Db::t( 'events' ) . ' WHERE entity_id = %s ORDER BY id DESC LIMIT 1', array( $done ) );
		eq( MARIA, $by, 'who handed it' );
		$snap = Azl_Snapshot::load();
		has( array( 'xFrom' => $done, 'xKind' => 'handoff', 'xNote' => 'Guest says it drips' ), $snap['items']->$next );
		// The same name keeps its target time; no name keeps the name.
		$again = id();
		cmd( array( 'type' => 'handOff', 'itemId' => $done, 'newItemId' => $again, 'dept' => 'housekeeping' ) );
		has( array( 'name' => 'Extra towels', 'sla_min' => '10', 'x_note' => null ), item_row( $again ) );
		$before = fingerprint();
		eq( array( 'ok' => false, 'error' => 'Only a done item can be handed off. Use Transfer for open work.' ), cmd( array( 'type' => 'handOff', 'itemId' => $next, 'newItemId' => id(), 'dept' => 'it' ) ) );
		eq( array( 'ok' => false, 'error' => 'Assign someone from that department' ), cmd( array( 'type' => 'handOff', 'itemId' => $done, 'newItemId' => id(), 'dept' => 'it', 'assignee' => JOEL ) ) );
		eq( array( 'ok' => false, 'error' => 'Unknown department' ), cmd( array( 'type' => 'handOff', 'itemId' => $done, 'newItemId' => id(), 'dept' => 'spa' ) ) );
		eq( array( 'ok' => false, 'error' => 'Keep the note under 191 characters' ), cmd( array( 'type' => 'handOff', 'itemId' => $done, 'newItemId' => id(), 'dept' => 'it', 'note' => str_repeat( 'n', 192 ) ) ) );
		eq( array( 'ok' => false, 'error' => 'Invalid id' ), cmd( array( 'type' => 'handOff', 'itemId' => $done, 'dept' => 'it' ) ) );
		eq( $before, fingerprint() );
	}
);

test(
	'requests: Transfer takes an optional reason and person; the copy shows them',
	function () {
		$it   = rq_item( 'on_site' );
		$copy = id();
		has( array( 'ok' => true ), cmd( array( 'type' => 'transfer', 'itemId' => $it, 'newItemId' => $copy, 'dept' => 'engineering', 'note' => 'Needs a ladder', 'assignee' => RAMON ) ) );
		has( array( 'x_kind' => 'transfer', 'x_note' => 'Needs a ladder', 'assignee' => RAMON ), item_row( $copy ) );
		has( array( 'status' => 'transferred', 'prev_status' => 'on_site' ), item_row( $it ) );
		eq( array( 'ok' => false, 'error' => 'Assign someone from that department' ), cmd( array( 'type' => 'transfer', 'itemId' => rq_item( 'relayed' ), 'newItemId' => id(), 'dept' => 'engineering', 'assignee' => JOEL ) ) );
	}
);

/* ---------- undo ---------- */

test(
	'undo: relay, on site and hold go back one step each; times and the hold clock are restored; history only grows',
	function () {
		$it = rq_item( 'on_hold' );
		has( array( 'status' => 'on_hold', 'prev_status' => 'on_site', 'held_ms' => '0' ), item_row( $it ) );
		azl_advance( 5 * 60000 );
		twice( array( 'type' => 'undoStep', 'itemId' => $it ) );
		// The hold is erased: its five minutes are working time, not held time.
		has( array( 'status' => 'on_site', 'hold_since' => null, 'hold_reason' => null, 'held_ms' => '0', 'prev_status' => null ), item_row( $it ) );
		$on_site = item_row( $it )['on_site_at'];
		ok( null !== $on_site, 'on-site time kept' );
		cmd( array( 'type' => 'undoStep', 'itemId' => $it ) );
		has( array( 'status' => 'relayed', 'on_site_at' => null ), item_row( $it ) );
		ok( null !== item_row( $it )['ack_at'], 'relay time kept' );
		cmd( array( 'type' => 'undoStep', 'itemId' => $it ) );
		has( array( 'status' => 'new', 'ack_at' => null, 'relayed_by' => null ), item_row( $it ) );
		eq( array( 'ok' => false, 'error' => 'Nothing to undo' ), cmd( array( 'type' => 'undoStep', 'itemId' => $it ) ) );
		eq( array( 'Logged', 'Relayed', 'On site', 'On hold', 'Undone: On hold', 'Undone: On site', 'Undone: Relayed' ), labels( $it ) );
		// Forward again works as usual.
		has( array( 'ok' => true ), cmd( array( 'type' => 'relay', 'itemId' => $it ) ) );
	}
);

test(
	'undo: on site straight from new goes back to new and clears the acknowledgement',
	function () {
		list( , $items ) = logged( '611', array( 'towels' ) );
		cmd( array( 'type' => 'onSite', 'itemId' => $items[0] ) );
		cmd( array( 'type' => 'undoStep', 'itemId' => $items[0] ) );
		has( array( 'status' => 'new', 'ack_at' => null, 'on_site_at' => null ), item_row( $items[0] ) );
	}
);

test(
	'undo: a close reopens where it was; closed on hold reopens on site; closed from new clears the acknowledgement',
	function () {
		$it = rq_item( 'done' );
		cmd( array( 'type' => 'undoStep', 'itemId' => $it ) );
		has( array( 'status' => 'on_site', 'done_at' => null ), item_row( $it ) );

		$held = rq_item( 'on_hold' );
		azl_advance( 3 * 60000 );
		cmd( array( 'type' => 'finish', 'itemId' => $held, 'status' => 'done' ) );
		cmd( array( 'type' => 'undoStep', 'itemId' => $held ) );
		has( array( 'status' => 'on_site', 'held_ms' => '180000', 'hold_since' => null, 'done_at' => null ), item_row( $held ) );

		list( , $fresh ) = logged( '612', array( 'water' ) );
		cmd( array( 'type' => 'finish', 'itemId' => $fresh[0], 'status' => 'cant_do' ) );
		cmd( array( 'type' => 'undoStep', 'itemId' => $fresh[0] ) );
		has( array( 'status' => 'new', 'ack_at' => null, 'done_at' => null ), item_row( $fresh[0] ) );
		eq( array( 'Logged', "Can't do", "Undone: Can't do" ), labels( $fresh[0] ) );
	}
);

test(
	'undo: a transfer comes back and its untouched copy is cancelled (kept); a started copy refuses',
	function () {
		$it   = rq_item( 'on_hold' );
		$copy = id();
		cmd( array( 'type' => 'transfer', 'itemId' => $it, 'newItemId' => $copy, 'dept' => 'engineering' ) );
		twice( array( 'type' => 'undoStep', 'itemId' => $it ) );
		has( array( 'status' => 'on_hold', 'done_at' => null, 'hold_reason' => 'dnd' ), item_row( $it ) );
		ok( null !== item_row( $it )['hold_since'], 'the hold clock is still stopped' );
		has( array( 'status' => 'cancelled' ), item_row( $copy ) );
		eq( array( 'Transferred in', 'Cancelled: transfer undone' ), labels( $copy ) );
		eq( array( 'ok' => false, 'error' => 'Nothing to undo' ), cmd( array( 'type' => 'undoStep', 'itemId' => $copy ) ), 'the cancelled copy stays cancelled' );

		$again = id();
		cmd( array( 'type' => 'transfer', 'itemId' => $it, 'newItemId' => $again, 'dept' => 'engineering' ) );
		cmd( array( 'type' => 'relay', 'itemId' => $again ) );
		$before = fingerprint();
		eq( array( 'ok' => false, 'error' => 'The other department already started on it. Ask them to transfer it back.' ), cmd( array( 'type' => 'undoStep', 'itemId' => $it ) ) );
		eq( $before, fingerprint() );
	}
);

test(
	'undo: a resume and a work-order close are refused; an escalation is undone like undoEscalate',
	function () {
		$it = rq_item( 'on_hold' );
		cmd( array( 'type' => 'resume', 'itemId' => $it ) );
		eq( array( 'ok' => false, 'error' => 'A resume cannot be undone. Put the item on hold again.' ), cmd( array( 'type' => 'undoStep', 'itemId' => $it ) ) );

		$ac = on_site_ac( '613' );
		$wo = id();
		cmd( array( 'type' => 'escalate', 'itemId' => $ac, 'woId' => $wo ) );
		has( array( 'ok' => true ), cmd( array( 'type' => 'undoStep', 'itemId' => $ac ) ) );
		has( array( 'status' => 'on_site', 'wo_id' => null ), item_row( $ac ) );
		$wo2 = id();
		cmd( array( 'type' => 'escalate', 'itemId' => $ac, 'woId' => $wo2 ) );
		cmd( array( 'type' => 'assessWo', 'woId' => $wo2, 'assessment' => 'x', 'assignType' => 'inhouse', 'estCost' => 0 ) );
		cmd( array( 'type' => 'startWo', 'woId' => $wo2 ) );
		cmd( array( 'type' => 'completeWo', 'woId' => $wo2, 'actualCost' => 0 ) );
		has( array( 'status' => 'done' ), item_row( $ac ) );
		eq( array( 'ok' => false, 'error' => 'Closed by its work order. Reopen the work order instead.' ), cmd( array( 'type' => 'undoStep', 'itemId' => $ac ) ) );
	}
);

test(
	'undo: the target rule for rows without prev_status (from before schema 3), as written in the rule block',
	function () {
		$row = fn( $status, $extra = array() ) => $extra + array( 'status' => $status, 'prev_status' => null, 'relayed_by' => null, 'on_site_at' => null, 'ack_at' => '1', 'wo_id' => null );
		eq( 'new', Azl_Commands::undo_target( $row( 'relayed' ) ) );
		eq( 'relayed', Azl_Commands::undo_target( $row( 'on_site' ) ), 'legacy on site: relayed' );
		eq( 'new', Azl_Commands::undo_target( $row( 'on_site', array( 'on_site_at' => '1', 'ack_at' => '1' ) ) ), 'went on site straight from new' );
		eq( 'relayed', Azl_Commands::undo_target( $row( 'on_site', array( 'on_site_at' => '5', 'ack_at' => '1' ) ) ) );
		eq( 'on_site', Azl_Commands::undo_target( $row( 'on_hold' ) ), 'legacy hold: on site' );
		eq( 'relayed', Azl_Commands::undo_target( $row( 'on_hold', array( 'prev_status' => 'relayed' ) ) ) );
		eq( 'relayed', Azl_Commands::undo_target( $row( 'done' ) ), 'legacy close without on-site time' );
		eq( 'on_site', Azl_Commands::undo_target( $row( 'done', array( 'on_site_at' => '3' ) ) ) );
		eq( 'on_site', Azl_Commands::undo_target( $row( 'transferred', array( 'on_site_at' => '3' ) ) ) );
		eq( 'on_hold', Azl_Commands::undo_target( $row( 'transferred', array( 'prev_status' => 'on_hold' ) ) ) );
		eq( '!Nothing to undo', Azl_Commands::undo_target( $row( 'new' ) ) );
		eq( '!Nothing to undo', Azl_Commands::undo_target( $row( 'escalated' ) ) );
	}
);

/* ---------- who may do what ---------- */

test(
	'requests access: desk roles edit tickets; department staff work only on their department and undo only their own steps',
	function () {
		list( $request, $items ) = rq_log( array( array( 'type' => 'towels' ), array( 'type' => 'ac' ) ) );
		list( $towels, $ac )     = $items;
		foreach ( array( 'owner', 'manager', 'supervisor', 'hdo' ) as $i => $kind ) {
			has( array( 'ok' => true ), rq_as( array( 'type' => 'editRequest', 'requestId' => $request, 'room' => "70$i" ), MARIA, $kind, null ), $kind );
		}
		$before = fingerprint();
		eq( array( 'ok' => false, 'error' => 'Only a supervisor or manager can do this in Requests.' ), rq_as( array( 'type' => 'editRequest', 'requestId' => $request, 'room' => '799' ), JOEL, 'staff', 'housekeeping' ) );
		eq( array( 'ok' => false, 'error' => Azl_Access::OWN ), rq_as( array( 'type' => 'editItem', 'itemId' => $ac, 'qty' => 2 ), JOEL, 'staff', 'housekeeping' ) );
		eq( array( 'ok' => false, 'error' => Azl_Access::OWN ), rq_as( array( 'type' => 'undoStep', 'itemId' => $ac ), JOEL, 'staff', 'housekeeping' ) );
		eq( array( 'ok' => false, 'error' => Azl_Access::NO_PIN ), rq_as( array( 'type' => 'editItem', 'itemId' => $towels, 'qty' => 2 ), JOEL, 'none', null ) );
		eq( $before, fingerprint() );
		has( array( 'ok' => true ), rq_as( array( 'type' => 'editItem', 'itemId' => $towels, 'qty' => 2 ), JOEL, 'staff', 'housekeeping' ) );
		// Joel relays his own item and may undo that; the desk relays the next one and Joel may not undo it.
		has( array( 'ok' => true ), rq_as( array( 'type' => 'relay', 'itemId' => $towels ), JOEL, 'staff', 'housekeeping' ) );
		has( array( 'ok' => true ), rq_as( array( 'type' => 'undoStep', 'itemId' => $towels ), JOEL, 'staff', 'housekeeping' ) );
		cmd( array( 'type' => 'relay', 'itemId' => $towels ) );
		eq( array( 'ok' => false, 'error' => 'You can only undo a step you took yourself. Ask the desk.' ), rq_as( array( 'type' => 'undoStep', 'itemId' => $towels ), JOEL, 'staff', 'housekeeping' ) );
		has( array( 'ok' => true ), rq_as( array( 'type' => 'undoStep', 'itemId' => $towels ), MARIA, 'hdo', 'frontdesk' ) );
		// Hand off: staff of the item's department only.
		cmd( array( 'type' => 'finish', 'itemId' => $ac, 'status' => 'done' ) );
		eq( array( 'ok' => false, 'error' => Azl_Access::OWN ), rq_as( array( 'type' => 'handOff', 'itemId' => $ac, 'newItemId' => id(), 'dept' => 'housekeeping' ), JOEL, 'staff', 'housekeeping' ) );
		has( array( 'ok' => true ), rq_as( array( 'type' => 'handOff', 'itemId' => $ac, 'newItemId' => id(), 'dept' => 'housekeeping' ), RAMON, 'staff', 'engineering' ) );
	}
);

test(
	'requests: the four new commands belong to Requests in the role matrix, read through the module registry',
	function () {
		foreach ( array( 'editRequest', 'editItem', 'handOff', 'undoStep' ) as $type ) {
			eq( 'requests', Azl_Access::module_of( $type ), $type );
		}
		eq( 'full', Azl_Modules::command( 'editRequest' )['need'] );
		eq( 'own', Azl_Modules::command( 'undoStep' )['need'] );
	}
);

/* ---------- the snapshot ---------- */

test(
	'requests snapshot: on-site time, relayed-by, previous status, item remarks and the ticket history travel to the desk',
	function () {
		$it = rq_item( 'on_site' );
		cmd( array( 'type' => 'editItem', 'itemId' => $it, 'remarks' => 'Left at the door' ) );
		$x = Azl_Snapshot::load()['items']->$it;
		has( array( 'status' => 'on_site', 'relayedBy' => MARIA, 'onSiteAt' => Azl_Db::now(), 'prevStatus' => 'relayed', 'remarks' => 'Left at the door' ), $x );
		ok( $x['ackAt'] < $x['onSiteAt'], 'relay then on site: Relay and Resp timers can be computed' );
	}
);

/* ---------- schema 3: upgrade a version 2 database that holds data ---------- */

test(
	'schema 3 upgrade: a version 2 database keeps every row, gains the new columns, and its old rows work with the new commands',
	function () {
		$pdo = $GLOBALS['wpdb']->pdo;
		$pdo->exec( 'DROP TABLE wp_azl_requests' );
		$pdo->exec( 'DROP TABLE wp_azl_items' );
		// The version 2 statements, as they shipped in plugin 0.4.0.
		$v2 = array(
			"CREATE TABLE wp_azl_requests (
  id char(36) NOT NULL,
  ticket_no int(11) unsigned NOT NULL,
  room varchar(40) NOT NULL,
  source varchar(10) NOT NULL,
  remarks text DEFAULT NULL,
  logged_by char(36) DEFAULT NULL,
  vip tinyint(1) NOT NULL DEFAULT 0,
  incomplete tinyint(1) NOT NULL DEFAULT 0,
  safety_id char(36) DEFAULT NULL,
  op_id char(36) NOT NULL,
  created_at bigint(20) NOT NULL,
  updated_at bigint(20) NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY ticket_no (ticket_no),
  UNIQUE KEY op_id (op_id),
  KEY created_at (created_at)
) ENGINE=InnoDB;",
			"CREATE TABLE wp_azl_items (
  id char(36) NOT NULL,
  request_id char(36) NOT NULL,
  pos smallint(5) unsigned NOT NULL DEFAULT 0,
  name varchar(120) NOT NULL,
  qty int(11) NOT NULL DEFAULT 1,
  dept varchar(20) NOT NULL,
  assignee char(36) DEFAULT NULL,
  status varchar(20) NOT NULL DEFAULT 'new',
  hold_reason varchar(20) DEFAULT NULL,
  created_at bigint(20) NOT NULL,
  updated_at bigint(20) NOT NULL,
  ack_at bigint(20) DEFAULT NULL,
  done_at bigint(20) DEFAULT NULL,
  hold_since bigint(20) DEFAULT NULL,
  held_ms bigint(20) NOT NULL DEFAULT 0,
  sla_min int(11) NOT NULL,
  depends_on char(36) DEFAULT NULL,
  x_from char(36) DEFAULT NULL,
  wo_id char(36) DEFAULT NULL,
  st_before_esc varchar(20) DEFAULT NULL,
  PRIMARY KEY  (id),
  KEY request_id (request_id,created_at),
  KEY open_items (status,created_at),
  KEY dept_queue (dept,status,created_at),
  KEY assignee (assignee,status)
) ENGINE=InnoDB;",
		);
		foreach ( $v2 as $sql ) {
			foreach ( azl_sqlite_ddl( $sql ) as $stmt ) {
				$pdo->exec( $stmt );
			}
		}
		$cols = fn( $t ) => array_column( $pdo->query( "PRAGMA table_info($t)" )->fetchAll( PDO::FETCH_ASSOC ), 'name' );
		ok( ! in_array( 'hdo', $cols( 'wp_azl_requests' ), true ), 'starts at version 2' );
		// Real-looking version 2 rows: a ticket with an item on hold (from on site) and a done one, plus a transfer.
		$req = id();
		$now = Azl_Db::now();
		Azl_Db::insert( 'requests', array( 'id' => $req, 'ticket_no' => 41, 'room' => '412', 'source' => 'staff', 'remarks' => 'Guest urgent', 'logged_by' => MARIA, 'vip' => 0, 'incomplete' => 0, 'op_id' => id(), 'created_at' => $now - 3600000, 'updated_at' => $now ) );
		$base = array( 'request_id' => $req, 'qty' => 1, 'dept' => 'housekeeping', 'sla_min' => 10, 'held_ms' => 0, 'created_at' => $now - 3600000, 'updated_at' => $now, 'ack_at' => $now - 3500000 );
		$held = id();
		$done = id();
		$gone = id();
		$copy = id();
		Azl_Db::insert( 'items', array( 'id' => $held, 'pos' => 0, 'name' => 'Extra towels', 'status' => 'on_hold', 'hold_reason' => 'dnd', 'hold_since' => $now - 600000 ) + $base );
		Azl_Db::insert( 'items', array( 'id' => $done, 'pos' => 1, 'name' => 'Toiletries', 'status' => 'done', 'done_at' => $now - 60000 ) + $base );
		Azl_Db::insert( 'items', array( 'id' => $gone, 'pos' => 2, 'name' => 'TV not working', 'status' => 'transferred', 'done_at' => $now - 60000 ) + $base );
		Azl_Db::insert( 'items', array( 'id' => $copy, 'pos' => 2, 'name' => 'TV not working', 'status' => 'new', 'x_from' => $gone, 'dept' => 'it' ) + $base );
		Azl_Db::exec( 'UPDATE ' . Azl_Db::t( 'seq' ) . " SET val = 41 WHERE name = 'ticket'" );
		update_option( 'azl_db_version', '2' );
		$before = Azl_Db::rows( 'SELECT * FROM wp_azl_items ORDER BY id' );

		Azl_Schema::maybe_upgrade();

		eq( Azl_Schema::db_version(), get_option( 'azl_db_version' ) );
		foreach ( array( 'hdo', 'staff_name' ) as $c ) {
			ok( in_array( $c, $cols( 'wp_azl_requests' ), true ), "requests.$c added" );
		}
		foreach ( array( 'relayed_by', 'on_site_at', 'prev_status', 'x_kind', 'x_note', 'remarks' ) as $c ) {
			ok( in_array( $c, $cols( 'wp_azl_items' ), true ), "items.$c added" );
		}
		$after = Azl_Db::rows( 'SELECT * FROM wp_azl_items ORDER BY id' );
		foreach ( $before as $i => $row ) {
			has( $row, $after[ $i ], 'old values unchanged' );
			has( array( 'relayed_by' => null, 'on_site_at' => null, 'prev_status' => null, 'x_kind' => null, 'x_note' => null, 'remarks' => null ), $after[ $i ], 'new columns empty' );
		}
		has( array( 'source' => 'staff', 'hdo' => null, 'staff_name' => null, 'room' => '412' ), rq_req( $req ) );
		// The desk reads the old rows.
		$snap = Azl_Snapshot::load();
		has( array( 'ticket' => 'T-0041', 'source' => 'staff' ), $snap['requests'][0] );
		ok( ! isset( $snap['items']->$held['prevStatus'] ), 'no previous status on an old row' );
		// And the new commands work on them, with the documented fallbacks.
		has( array( 'ok' => true ), cmd( array( 'type' => 'undoStep', 'itemId' => $held ) ) );
		has( array( 'status' => 'on_site', 'hold_since' => null ), item_row( $held ) );
		has( array( 'ok' => true ), cmd( array( 'type' => 'undoStep', 'itemId' => $done ) ) );
		has( array( 'status' => 'relayed', 'done_at' => null ), item_row( $done ) );
		has( array( 'ok' => true ), cmd( array( 'type' => 'undoStep', 'itemId' => $gone ) ) );
		has( array( 'status' => 'relayed' ), item_row( $gone ) );
		has( array( 'status' => 'cancelled' ), item_row( $copy ) );
		has( array( 'ok' => true ), cmd( array( 'type' => 'editRequest', 'requestId' => $req, 'source' => 'staff_request', 'staffName' => 'Lynette, HK' ) ) );
		eq( array( 'Requested by: Guest → Staff (Lynette, HK)' ), labels( $req ) );
		list( , , $res ) = logged( '413', array( 'towels' ) );
		eq( 42, $res['ticketNo'], 'numbering continues' );
	}
);
