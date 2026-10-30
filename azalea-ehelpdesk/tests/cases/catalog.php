<?php
/**
 * Azl_Catalog: the hotel's own lists, their validation and referential integrity, the REST routes and
 * how commands, staff admin and the snapshot use them.
 */

/** Saves one list against the current revision (or $rev). @return array{0: int, 1: array} */
function save_list( string $list, array $items, ?int $rev = null ): array {
	return Azl_Catalog::save( $list, $items, $rev ?? Azl_Catalog::get()['catalogRev'] );
}

/** The current list with $fn applied to the entry with $key. */
function edited( string $list, string $key, callable $fn ): array {
	return array_map(
		static function ( $x ) use ( $key, $fn ) {
			return $x['key'] === $key ? $fn( $x ) : $x;
		},
		Azl_Catalog::get()[ $list ]
	);
}

/** The current list without the entry with $key. */
function without( string $list, string $key ): array {
	return array_values(
		array_filter(
			Azl_Catalog::get()[ $list ],
			static function ( $x ) use ( $key ) {
				return $x['key'] !== $key;
			}
		)
	);
}

function archived( array $x ): array {
	return array( 'active' => false ) + $x;
}

/** Adds a department "Spa" (key spa) and a request type "Massage" (key massage) in it. */
function add_spa(): void {
	$depts   = Azl_Catalog::get()['departments'];
	$depts[] = array( 'label' => 'Spa', 'short' => 'SPA', 'active' => true );
	eq( 200, save_list( 'departments', $depts )[0], 'add Spa' );
	$types   = Azl_Catalog::get()['requestTypes'];
	$types[] = array( 'label' => 'Massage', 'dept' => 'spa', 'slaMin' => 60, 'icon' => 'spa', 'active' => true );
	eq( 200, save_list( 'requestTypes', $types )[0], 'add Massage' );
}

/** [status, code, error] of a save, for short assertions. */
function refusal( array $r ): array {
	return array( $r[0], $r[1]['code'] ?? null, $r[1]['error'] ?? null );
}

/* ---------- seed and reading ---------- */

test(
	'catalog: the seed equals the old constants, is stored once on first read, and starts at revision 0',
	function () {
		eq( null, get_option( Azl_Catalog::OPTION, null ), 'nothing stored before the first read' );
		$c = Azl_Catalog::get();
		eq( 0, $c['catalogRev'] );
		eq( array_keys( Azl_Rules::DEPTS ), array_column( $c['departments'], 'key' ) );
		foreach ( $c['departments'] as $d ) {
			eq( array( 'key' => $d['key'], 'label' => Azl_Rules::DEPTS[ $d['key'] ]['label'], 'short' => Azl_Rules::DEPTS[ $d['key'] ]['short'], 'repairs' => Azl_Rules::DEPTS[ $d['key'] ]['repairs'], 'active' => true ), $d );
		}
		eq( array( 'engineering', 'it' ), array_values( array_column( array_filter( $c['departments'], static function ( $d ) { return $d['repairs']; } ), 'key' ) ), 'only engineering and IT handle repairs at first' );
		eq( array_keys( Azl_Rules::PRESETS ), array_column( $c['requestTypes'], 'key' ) );
		foreach ( $c['requestTypes'] as $t ) {
			list( $label, $dept, $sla, $icon ) = Azl_Rules::PRESETS[ $t['key'] ];
			eq( array( 'key' => $t['key'], 'label' => $label, 'dept' => $dept, 'slaMin' => $sla, 'icon' => $icon, 'active' => true ), $t );
			ok( in_array( $icon, Azl_Catalog::ICONS, true ), "seed icon $icon is allowed" );
		}
		eq( array( 'key' => 'leak', 'label' => 'Leak', 'hint' => Azl_Rules::BUNDLES['leak']['hint'], 'parts' => Azl_Rules::BUNDLES['leak']['parts'], 'active' => true ), $c['bundles'][0] );
		eq( Azl_Rules::HOLD_REASONS, array_column( $c['holdReasons'], 'label', 'key' ) );
		eq( Azl_Rules::JOB_TITLES, array_column( $c['jobTitles'], 'label', 'key' ) );
		eq( Azl_Rules::WO_FINDINGS, array_column( $c['woFindings'], 'label', 'key' ) );
		ok( is_string( get_option( Azl_Catalog::OPTION ) ), 'stored as JSON on first read' );
		eq( $c, json_decode( get_option( Azl_Catalog::OPTION ), true ) );
		eq( $c, Azl_Catalog::get(), 'second read' );
		foreach ( Azl_Catalog::LISTS as $list ) {
			foreach ( $c[ $list ] as $x ) {
				ok( 1 === preg_match( '/^[a-z0-9_]{2,20}$/', $x['key'] ), "seed key {$x['key']} fits varchar(20)" );
			}
		}
	}
);

test(
	'catalog: a stored value that is not a catalog falls back to the seed without overwriting it',
	function () {
		update_option( Azl_Catalog::OPTION, '{"broken":' );
		eq( Azl_Catalog::seed(), Azl_Catalog::get() );
		eq( '{"broken":', get_option( Azl_Catalog::OPTION ) );
	}
);

/* ---------- saving and validation ---------- */

test(
	'catalog: saving replaces the whole list, makes keys from labels, keeps keys of existing entries, bumps catalogRev and the poll counter',
	function () {
		$change = Azl_Db::counter( 'change' );
		$depts  = edited(
			'departments',
			'fnb',
			static function ( $x ) {
				return array( 'label' => 'Restaurant', 'short' => 'REST' ) + $x;
			}
		);
		$depts  = array_reverse( $depts );
		$depts[] = array( 'label' => '  Spa & <b>Wellness</b> ', 'short' => 'SPA', 'active' => true );
		$depts[] = array( 'label' => 'Spa-Wellness', 'short' => 'SW', 'active' => true );
		$depts[] = array( 'label' => 'Concierge desk for long-stay guests 24h', 'short' => 'CON', 'active' => true );
		$depts[] = array( 'label' => 'é', 'short' => 'E' );
		list( $status, $out ) = save_list( 'departments', $depts );
		eq( 200, $status, json_encode( $out ) );
		eq( true, $out['ok'] );
		$saved = $out['catalog']['departments'];
		eq( array( 'security', 'frontdesk', 'fnb', 'it', 'engineering', 'housekeeping', 'spa_wellness', 'spa_wellness_2', 'concierge_desk_for_l', 'item' ), array_column( $saved, 'key' ), 'order is array order; new keys from labels, unique, 2 to 20 characters' );
		eq( array( 'key' => 'fnb', 'label' => 'Restaurant', 'short' => 'REST', 'repairs' => false, 'active' => true ), $saved[2], 'the key stays when the label changes' );
		eq( 'Spa & Wellness', $saved[6]['label'], 'tags stripped, trimmed' );
		eq( true, $saved[9]['active'], 'active by default' );
		eq( 1, $out['catalog']['catalogRev'] );
		eq( $out['catalog'], Azl_Catalog::get() );
		eq( $change + 1, Azl_Db::counter( 'change' ), 'phones see the change on their next poll' );
		eq( $change + 1, Azl_Snapshot::load()['rev'], 'the snapshot rev moves with it' );
		eq( $out['catalog'], Azl_Snapshot::load()['catalog'], 'the snapshot carries the lists' );
		eq( 'x_2', Azl_Catalog::make_key( 'x', array() ), 'one-letter labels get a suffix' );
		eq( 'housekeeping_2', Azl_Catalog::make_key( 'Housekeeping', array( 'housekeeping' => true ) ) );
		eq( 'abcdefghijklmnopqr_2', Azl_Catalog::make_key( 'abcdefghijklmnopqrstuvwxyz', array( 'abcdefghijklmnopqrst' => true ) ) );
	}
);

test(
	'catalog: every validation rule refuses with a message and the index, and writes nothing',
	function () {
		Azl_Catalog::get();
		$before = get_option( Azl_Catalog::OPTION );
		$change = Azl_Db::counter( 'change' );
		$d      = Azl_Catalog::get()['departments'];
		$t      = Azl_Catalog::get()['requestTypes'];
		$b      = Azl_Catalog::get()['bundles'];
		$type   = array( 'label' => 'Massage', 'dept' => 'housekeeping', 'slaMin' => 30, 'icon' => 'spa', 'active' => true );
		$part   = array( 'name' => 'Fix', 'dept' => 'engineering', 'slaMin' => 20 );
		$bundle = array( 'label' => 'Flood', 'hint' => 'Fix then clean', 'parts' => array( $part ), 'active' => true );
		$cases  = array(
			array( 'departments', array_merge( $d, array( array( 'label' => '', 'short' => 'X' ) ) ), 6, 'Enter a name of 1 to 40 characters.' ),
			array( 'departments', array_merge( $d, array( array( 'label' => str_repeat( 'a', 41 ), 'short' => 'X' ) ) ), 6, 'Enter a name of 1 to 40 characters.' ),
			array( 'departments', array_merge( $d, array( array( 'label' => '<b></b>', 'short' => 'X' ) ) ), 6, 'Enter a name of 1 to 40 characters.' ),
			array( 'departments', array_merge( $d, array( array( 'label' => 'front DESK', 'short' => 'X' ) ) ), 6, "\u{201C}front DESK\u{201D} is already in this list." ),
			array( 'departments', array_merge( $d, array( array( 'label' => 'Spa', 'short' => '' ) ) ), 6, 'Enter a short code of 1 to 6 characters.' ),
			array( 'departments', array_merge( $d, array( array( 'label' => 'Spa', 'short' => 'SPAWELL' ) ) ), 6, 'Enter a short code of 1 to 6 characters.' ),
			array( 'departments', array_merge( $d, array( array( 'label' => 'Spa', 'short' => 'S', 'active' => 'yes' ) ) ), 6, 'Choose active or archived.' ),
			array( 'departments', array_merge( $d, array( array( 'label' => 'Spa', 'short' => 'S', 'repairs' => 1 ) ) ), 6, 'Choose whether it handles repairs.' ),
			array( 'departments', array_merge( $d, array( array( 'key' => 'invented', 'label' => 'Spa', 'short' => 'S' ) ) ), 6, 'This entry no longer exists. Reload the list.' ),
			array( 'departments', array_merge( $d, array( $d[0] ) ), 6, 'This entry is in the list twice.' ),
			array( 'departments', array_merge( $d, array( 'Spa' ) ), 6, 'This entry is not valid.' ),
			array( 'requestTypes', array_merge( $t, array( array( 'dept' => 'nowhere' ) + $type ) ), 14, 'Pick a department.' ),
			array( 'requestTypes', array_merge( $t, array( array( 'slaMin' => 0 ) + $type ) ), 14, 'Set a target of 1 to 1440 minutes.' ),
			array( 'requestTypes', array_merge( $t, array( array( 'slaMin' => 1441 ) + $type ) ), 14, 'Set a target of 1 to 1440 minutes.' ),
			array( 'requestTypes', array_merge( $t, array( array( 'slaMin' => '30' ) + $type ) ), 14, 'Set a target of 1 to 1440 minutes.' ),
			array( 'requestTypes', array_merge( $t, array( array( 'slaMin' => 2.5 ) + $type ) ), 14, 'Set a target of 1 to 1440 minutes.' ),
			array( 'requestTypes', array_merge( $t, array( array( 'icon' => 'siren' ) + $type ) ), 14, 'Pick an icon from the list.' ),
			array( 'requestTypes', array_merge( $t, array( array( 'icon' => '<svg onload=x>' ) + $type ) ), 14, 'Pick an icon from the list.' ),
			array( 'bundles', array_merge( $b, array( array( 'parts' => array() ) + $bundle ) ), 1, 'A bundle has 1 to 6 steps.' ),
			array( 'bundles', array_merge( $b, array( array( 'parts' => array_fill( 0, 7, $part ) ) + $bundle ) ), 1, 'A bundle has 1 to 6 steps.' ),
			array( 'bundles', array_merge( $b, array( array( 'parts' => array( $part, array( 'after' => 1 ) + $part ) ) + $bundle ) ), 1, 'Step 2 can only wait for an earlier step.' ),
			array( 'bundles', array_merge( $b, array( array( 'parts' => array( array( 'after' => 0 ) + $part ) ) + $bundle ) ), 1, 'Step 1 can only wait for an earlier step.' ),
			array( 'bundles', array_merge( $b, array( array( 'parts' => array( array( 'dept' => 'nowhere' ) + $part ) ) + $bundle ) ), 1, 'Step 1: Pick a department.' ),
			array( 'bundles', array_merge( $b, array( array( 'parts' => array( array( 'name' => '' ) + $part ) ) + $bundle ) ), 1, 'Step 1: enter a name of 1 to 40 characters.' ),
			array( 'bundles', array_merge( $b, array( array( 'parts' => array( array( 'slaMin' => -5 ) + $part ) ) + $bundle ) ), 1, 'Step 1: set a target of 1 to 1440 minutes.' ),
			array( 'bundles', array_merge( $b, array( array( 'hint' => str_repeat( 'h', 121 ) ) + $bundle ) ), 1, 'Keep the description under 120 characters.' ),
			array( 'holdReasons', array( array( 'label' => 'Waiting' ), array( 'label' => 'WAITING' ) ), 1, "\u{201C}WAITING\u{201D} is already in this list." ),
		);
		foreach ( $cases as $n => list( $list, $items, $index, $error ) ) {
			list( $status, $out ) = save_list( $list, $items );
			eq( array( 400, 'azl_invalid', $error, $index ), array( $status, $out['code'] ?? null, $out['error'] ?? null, $out['index'] ?? null ), "case $n ($list)" );
		}
		$limits = array( 'departments' => 40, 'requestTypes' => 80, 'bundles' => 20, 'holdReasons' => 20, 'jobTitles' => 60, 'woFindings' => 20 );
		foreach ( $limits as $list => $max ) {
			$many = array();
			for ( $i = 0; $i <= $max; $i++ ) {
				$many[] = array( 'label' => "Entry $i" );
			}
			eq( 400, save_list( $list, $many )[0], "more than $max $list" );
		}
		eq( array( 400, 'azl_invalid', 'Keep at least one active department.' ), refusal( save_list( 'departments', array_map( 'archived', $d ) ) ) );
		eq( array( 400, 'azl_invalid', 'Keep at least one active hold reason.' ), refusal( save_list( 'holdReasons', array_map( 'archived', Azl_Catalog::get()['holdReasons'] ) ) ) );
		eq( array( 400, 'azl_invalid', 'Send the whole list and the version you loaded.' ), refusal( Azl_Catalog::save( 'departments', array( 'a' => 1 ), 0 ) ) );
		eq( array( 400, 'azl_invalid', 'Send the whole list and the version you loaded.' ), refusal( Azl_Catalog::save( 'departments', $d, '0' ) ) );
		eq( 404, Azl_Catalog::save( 'staff', $d, 0 )[0] );
		eq( $before, get_option( Azl_Catalog::OPTION ), 'nothing stored' );
		eq( $change, Azl_Db::counter( 'change' ), 'no poll bump' );
		// An archived request type may point at an archived department; an active one may not.
		add_spa();
		eq( 200, save_list( 'requestTypes', edited( 'requestTypes', 'massage', 'archived' ) )[0] );
		eq( 200, save_list( 'departments', edited( 'departments', 'spa', 'archived' ) )[0] );
		$revive = edited(
			'requestTypes',
			'massage',
			static function ( $x ) {
				return array( 'active' => true ) + $x;
			}
		);
		eq( array( 400, 'azl_invalid', 'Pick an active department, or archive this first.' ), refusal( save_list( 'requestTypes', $revive ) ) );
	}
);

test(
	'catalog: a stale baseRev is refused with 409 azl_stale and the current lists',
	function () {
		$rev = Azl_Catalog::get()['catalogRev'];
		eq( 200, save_list( 'holdReasons', array_merge( Azl_Catalog::get()['holdReasons'], array( array( 'label' => 'Waiting for security' ) ) ), $rev )[0] );
		list( $status, $out ) = save_list( 'jobTitles', array( array( 'label' => 'Spa therapist' ) ), $rev );
		eq( 409, $status );
		has( array( 'ok' => false, 'code' => 'azl_stale', 'error' => Azl_Catalog::STALE ), $out );
		eq( Azl_Catalog::get(), $out['catalog'], 'the fresh lists come back to reload the editor' );
		ok( isset( $out['usage'] ), 'with usage' );
		eq( Azl_Rules::JOB_TITLES, array_column( Azl_Catalog::get()['jobTitles'], 'label', 'key' ), 'the stale save changed nothing' );
		eq( 409, save_list( 'jobTitles', array(), $rev + 7 )[0], 'a revision from the future is stale too' );
	}
);

/* ---------- referential integrity ---------- */

test(
	'catalog: a department in use cannot be deleted (counts in the message), can be archived and restored; unused ones can be deleted',
	function () {
		add_spa();
		// Spa is used by a request type only: delete refused, naming it.
		eq( array( 409, 'azl_in_use', 'Spa is used by the request type Massage. Move them to another department or delete them first.' ), refusal( save_list( 'departments', without( 'departments', 'spa' ) ) ) );
		// Archive refused while an active request type uses it.
		$r = save_list( 'departments', edited( 'departments', 'spa', 'archived' ) );
		eq( array( 409, 'azl_in_use', 'Spa is used by the active request type Massage. Archive them or move them to another department first.' ), refusal( $r ) );
		eq( 6, $r[1]['index'] );
		// Records: two people (one removed later), requests and a work order.
		Azl_Staff::create( array( 'name' => 'Tess Spa', 'title' => 'Therapist', 'role' => 'staff', 'dept' => 'spa' ), '8352' );
		$gone = Azl_Staff::create( array( 'name' => 'Old Spa', 'title' => 'Therapist', 'role' => 'staff', 'dept' => 'spa' ), '8352' )['id'];
		Azl_Staff::deactivate( $gone );
		logged( '601', array( 'massage' ) );
		logged( '602', array( 'massage', 'massage' ) );
		Azl_Db::insert( 'work_orders', array( 'id' => id(), 'wo_no' => 77, 'area' => 'Spa', 'loc' => 'Spa room', 'descr' => 'Fix the lamp', 'dept' => 'spa', 'status' => 'reported', 'op_id' => id(), 'created_at' => Azl_Db::now(), 'updated_at' => Azl_Db::now() ) );
		$usage = json_decode( json_encode( Azl_Catalog::usage() ), true );
		eq( array( 'people' => 2, 'requests' => 2, 'workOrders' => 1 ), $usage['departments']['spa'] );
		eq( 200, save_list( 'requestTypes', without( 'requestTypes', 'massage' ) )[0], 'request types are copied into items, so they can always be deleted' );
		$r = save_list( 'departments', without( 'departments', 'spa' ) );
		eq( array( 409, 'azl_in_use', 'Spa is used by 2 people, 2 requests and 1 work order. Archive it instead.' ), refusal( $r ) );
		eq( 'spa', $r[1]['key'] );
		ok( null !== Azl_Catalog::find( Azl_Catalog::get(), 'departments', 'spa' ), 'still there' );
		// Archive works; records keep the key and the snapshot still has its label.
		eq( 200, save_list( 'departments', edited( 'departments', 'spa', 'archived' ) )[0] );
		has( array( 'key' => 'spa', 'label' => 'Spa', 'active' => false ), Azl_Catalog::find( Azl_Catalog::get(), 'departments', 'spa' ) );
		eq( 'spa', Azl_Snapshot::load()['staff'][4]['dept'] );
		// Restore re-activates.
		$restore = edited(
			'departments',
			'spa',
			static function ( $x ) {
				return array( 'active' => true ) + $x;
			}
		);
		eq( 200, save_list( 'departments', $restore )[0] );
		eq( true, Azl_Catalog::find( Azl_Catalog::get(), 'departments', 'spa' )['active'] );
		// An unused department deletes; the bundle-only use is reported too.
		$depts   = Azl_Catalog::get()['departments'];
		$depts[] = array( 'label' => 'Laundry', 'short' => 'LDY' );
		eq( 200, save_list( 'departments', $depts )[0] );
		$bundles   = Azl_Catalog::get()['bundles'];
		$bundles[] = array( 'label' => 'Stain', 'hint' => '', 'parts' => array( array( 'name' => 'Wash', 'dept' => 'laundry', 'slaMin' => 60 ) ), 'active' => false );
		eq( 200, save_list( 'bundles', $bundles )[0] );
		eq( array( 409, 'azl_in_use', 'Laundry is used by the bundle Stain. Move them to another department or delete them first.' ), refusal( save_list( 'departments', without( 'departments', 'laundry' ) ) ) );
		eq( 200, save_list( 'departments', edited( 'departments', 'laundry', 'archived' ) )[0], 'an archived bundle does not block archiving' );
		eq( 200, save_list( 'bundles', without( 'bundles', 'stain' ) )[0] );
		eq( 200, save_list( 'departments', without( 'departments', 'laundry' ) )[0], 'unused: deleted' );
		eq( null, Azl_Catalog::find( Azl_Catalog::get(), 'departments', 'laundry' ) );
	}
);

test(
	'catalog: a hold reason held by an item cannot be deleted; archived, the held item keeps its key and label',
	function () {
		list( , $items ) = logged( '610', array( 'ac' ) );
		cmd( array( 'type' => 'onSite', 'itemId' => $items[0] ) );
		cmd( array( 'type' => 'hold', 'itemId' => $items[0], 'reason' => 'vendor' ) );
		eq( array( 409, 'azl_in_use', 'Waiting for vendor is used by 1 request. Archive it instead.' ), refusal( save_list( 'holdReasons', without( 'holdReasons', 'vendor' ) ) ) );
		eq( 200, save_list( 'holdReasons', edited( 'holdReasons', 'vendor', 'archived' ) )[0] );
		$s = Azl_Snapshot::load();
		eq( 'vendor', $s['items']->{$items[0]}['holdReason'] );
		eq( 'Waiting for vendor', Azl_Catalog::find( $s['catalog'], 'holdReasons', 'vendor' )['label'] );
		eq( 200, save_list( 'holdReasons', without( 'holdReasons', 'dnd' ) )[0], 'unused reason deleted' );
		// Job titles and findings are suggestions: always deletable.
		eq( 200, save_list( 'jobTitles', array() )[0] );
		eq( 200, save_list( 'woFindings', array() )[0] );
	}
);

/* ---------- commands and staff use the catalog ---------- */

test(
	'catalog: logRequest uses custom request types and bundles, refuses archived ones, and copies name, department and SLA',
	function () {
		add_spa();
		$bundles   = Azl_Catalog::get()['bundles'];
		$bundles[] = array(
			'label' => 'Spa day',
			'hint'  => 'Massage, then a room tidy',
			'parts' => array(
				array( 'name' => 'Spa: massage', 'dept' => 'spa', 'slaMin' => 90 ),
				array( 'name' => 'Spa: tidy room', 'dept' => 'housekeeping', 'slaMin' => 20, 'after' => 0 ),
			),
		);
		eq( 200, save_list( 'bundles', $bundles )[0] );
		list( , $items, $res ) = logged( '620', array( 'massage' ), array( 'bundle' => 'spa_day' ) );
		has( array( 'ok' => true, 'applied' => true ), $res );
		has( array( 'name' => 'Massage', 'dept' => 'spa', 'sla_min' => '60' ), item_row( $items[0] ) );
		has( array( 'name' => 'Spa: massage', 'dept' => 'spa', 'sla_min' => '90', 'depends_on' => null ), item_row( $items[1] ) );
		has( array( 'name' => 'Spa: tidy room', 'dept' => 'housekeeping', 'depends_on' => $items[1] ), item_row( $items[2] ) );
		// Renaming the type later never changes the logged item.
		$renamed = edited(
			'requestTypes',
			'massage',
			static function ( $x ) {
				return array( 'label' => 'Back massage', 'slaMin' => 45 ) + $x;
			}
		);
		eq( 200, save_list( 'requestTypes', $renamed )[0] );
		has( array( 'name' => 'Massage', 'sla_min' => '60' ), item_row( $items[0] ) );
		// Archived types and bundles are refused for new requests and new details.
		eq( 200, save_list( 'requestTypes', edited( 'requestTypes', 'towels', 'archived' ) )[0] );
		eq( 200, save_list( 'bundles', edited( 'bundles', 'leak', 'archived' ) )[0] );
		eq( array( 'ok' => false, 'error' => 'Unknown request type' ), logged( '621', array( 'towels' ) )[2] );
		eq( array( 'ok' => false, 'error' => 'Unknown request type' ), logged( '621', array(), array( 'bundle' => 'leak' ) )[2] );
		list( $later ) = logged( '622', array(), array( 'later' => true ) );
		$before        = fingerprint();
		eq( array( 'ok' => false, 'error' => 'Unknown request type' ), cmd( array( 'type' => 'completeRequest', 'requestId' => $later, 'itemIds' => array( id() ), 'presets' => array( 'towels' ) ) ) );
		eq( $before, fingerprint() );
		has( array( 'ok' => true ), cmd( array( 'type' => 'completeRequest', 'requestId' => $later, 'itemIds' => array( id() ), 'presets' => array( 'massage' ) ) ) );
	}
);

test(
	'catalog: transfer only to an active department; hold only with an active reason; held items keep an archived reason',
	function () {
		add_spa();
		list( , $items ) = logged( '630', array( 'tv', 'ac' ) );
		$copy            = id();
		has( array( 'ok' => true ), cmd( array( 'type' => 'transfer', 'itemId' => $items[0], 'newItemId' => $copy, 'dept' => 'spa' ) ) );
		has( array( 'dept' => 'spa', 'status' => 'new' ), item_row( $copy ) );
		eq( 200, save_list( 'requestTypes', edited( 'requestTypes', 'massage', 'archived' ) )[0] );
		eq( 200, save_list( 'departments', edited( 'departments', 'spa', 'archived' ) )[0] );
		$before = fingerprint();
		eq( array( 'ok' => false, 'error' => 'Unknown department' ), cmd( array( 'type' => 'transfer', 'itemId' => $items[1], 'newItemId' => id(), 'dept' => 'spa' ) ) );
		eq( $before, fingerprint() );
		// The item already in the archived department still works.
		has( array( 'ok' => true ), cmd( array( 'type' => 'relay', 'itemId' => $copy ) ) );
		// Hold reasons.
		$reasons   = Azl_Catalog::get()['holdReasons'];
		$reasons[] = array( 'label' => 'Waiting for the guest to return' );
		$saved     = save_list( 'holdReasons', $reasons )[1]['catalog']['holdReasons'];
		eq( 'waiting_for_the_gues', $saved[5]['key'] );
		has( array( 'ok' => true ), cmd( array( 'type' => 'hold', 'itemId' => $copy, 'reason' => 'waiting_for_the_gues' ) ) );
		eq( 200, save_list( 'holdReasons', edited( 'holdReasons', 'waiting_for_the_gues', 'archived' ) )[0] );
		cmd( array( 'type' => 'onSite', 'itemId' => $items[1] ) );
		eq( array( 'ok' => false, 'error' => 'Unknown hold reason' ), cmd( array( 'type' => 'hold', 'itemId' => $items[1], 'reason' => 'waiting_for_the_gues' ) ) );
		eq( 'waiting_for_the_gues', item_row( $copy )['hold_reason'], 'the held item keeps it' );
		has( array( 'ok' => true ), cmd( array( 'type' => 'resume', 'itemId' => $copy ) ) );
	}
);

test(
	'catalog: staff create and update accept active departments, or the person\'s current archived one',
	function () {
		add_spa();
		$made = Azl_Staff::create( array( 'name' => 'Tess', 'title' => 'Spa therapist', 'role' => 'staff', 'dept' => 'spa' ), '8352' );
		has( array( 'ok' => true ), $made );
		eq( 200, save_list( 'requestTypes', edited( 'requestTypes', 'massage', 'archived' ) )[0] );
		eq( 200, save_list( 'departments', edited( 'departments', 'spa', 'archived' ) )[0] );
		eq( array( 'ok' => false, 'error' => 'Pick a department.' ), Azl_Staff::create( array( 'name' => 'New', 'title' => 'Therapist', 'role' => 'staff', 'dept' => 'spa' ), '8352' ) );
		eq( array( 'ok' => true ), Azl_Staff::update( $made['id'], array( 'name' => 'Tess Cruz' ) ), 'keeps the archived department' );
		eq( array( 'ok' => false, 'error' => 'Pick a department.' ), Azl_Staff::update( JOEL, array( 'dept' => 'spa' ) ), 'cannot move someone into an archived one' );
		eq( array( 'ok' => false, 'error' => 'Pick a department.' ), Azl_Staff::update( JOEL, array( 'dept' => 'nowhere' ) ) );
		eq( array( 'ok' => true ), Azl_Staff::update( $made['id'], array( 'dept' => 'housekeeping' ) ) );
		eq( array( 'ok' => true ), Azl_Staff::update( $made['id'], array( 'dept' => null ) ) );
	}
);

/* ---------- REST and permissions ---------- */

test(
	'catalog REST: GET for every desk role, PUT only for owners, managers and administrators; bodies and codes',
	function () {
		cast();
		Azl_Rest::register_routes();
		$routes = $GLOBALS['azl_wp']['routes'];
		eq( array( Azl_Rest::class, 'can_use_desk' ), $routes['azl-ehd/v1/catalog']['permission_callback'] );
		$put = $routes['azl-ehd/v1/catalog/(?P<list>' . implode( '|', Azl_Catalog::lists() ) . ')']; // module lists (cleaningTypes, woAreas, ...) join the route
		ok( 0 === strpos( implode( '|', Azl_Catalog::lists() ), 'departments|requestTypes|bundles|holdReasons|jobTitles|woFindings' ), 'built-in lists first' );
		eq( array( 'PUT', array( Azl_Rest::class, 'can_manage_lists' ) ), array( $put['methods'], $put['permission_callback'] ) );
		$matrix = array(
			OWNER_ID => array( true, true ),
			MGR_ID   => array( true, true ),
			ADMIN_ID => array( true, true ),
			SUP_ID   => array( true, false ),
			PHONE_ID => array( true, false ),
			SUB_ID   => array( false, false ),
		);
		foreach ( $matrix as $id => list( $read, $write ) ) {
			as_user( $id );
			eq( array( $read, $write ), array( Azl_Rest::can_use_desk(), Azl_Rest::can_manage_lists() ), "user $id" );
		}
		as_user( MGR_ID );
		$got = Azl_Rest::catalog( new WP_REST_Request( 'GET' ) );
		eq( 200, $got->get_status() );
		eq( 'no-store, max-age=0', $got->get_headers()['Cache-Control'] );
		has( array( 'ok' => true, 'catalog' => Azl_Catalog::get() ), $got->get_data() );
		$req = static function ( string $list, $body ) {
			$r = new WP_REST_Request( 'PUT' );
			$r->set_param( 'list', $list );
			$r->set_body( is_string( $body ) ? $body : json_encode( $body ) );
			return Azl_Rest::put_catalog( $r );
		};
		$ok = $req( 'jobTitles', array( 'items' => array( array( 'label' => 'Spa therapist' ) ), 'baseRev' => 0 ) );
		eq( 200, $ok->get_status() );
		eq( array( array( 'key' => 'spa_therapist', 'label' => 'Spa therapist', 'active' => true ) ), $ok->get_data()['catalog']['jobTitles'] );
		has( array( 'code' => 'azl_stale' ), $req( 'jobTitles', array( 'items' => array(), 'baseRev' => 0 ) )->get_data() );
		eq( 409, $req( 'jobTitles', array( 'items' => array(), 'baseRev' => 0 ) )->get_status() );
		eq( 400, $req( 'jobTitles', 'not json' )->get_status() );
		eq( 400, $req( 'jobTitles', array( 'items' => 'x', 'baseRev' => 1 ) )->get_status() );
		$GLOBALS['wpdb']->pdo->exec( 'DROP TABLE wp_azl_seq' );
		$boom = $req( 'jobTitles', array( 'items' => array(), 'baseRev' => 1 ) );
		eq( array( 500, array( 'ok' => false, 'error' => 'Something went wrong. Try again.' ) ), array( $boom->get_status(), $boom->get_data() ) );
	}
);

test(
	'catalog: escalation follows the repairs flag; existing work orders carry on; open work orders need one active repairs department',
	function () {
		// A new department defaults to no repairs; Maintenance with the flag can escalate.
		$depts   = Azl_Catalog::get()['departments'];
		$depts[] = array( 'label' => 'Maintenance', 'short' => 'MNT' );
		$depts[] = array( 'label' => 'Grounds', 'short' => 'GRD', 'repairs' => true );
		$saved   = save_list( 'departments', $depts )[1]['catalog']['departments'];
		eq( array( false, true ), array( $saved[6]['repairs'], $saved[7]['repairs'] ) );
		$types   = Azl_Catalog::get()['requestTypes'];
		$types[] = array( 'label' => 'Broken bench', 'dept' => 'grounds', 'slaMin' => 60, 'icon' => 'wrench' );
		$types[] = array( 'label' => 'Squeaky door', 'dept' => 'maintenance', 'slaMin' => 60, 'icon' => 'home' );
		eq( 200, save_list( 'requestTypes', $types )[0] );
		list( , $items ) = logged( '640', array( 'broken_bench', 'squeaky_door', 'ac' ) );
		foreach ( $items as $it ) {
			cmd( array( 'type' => 'onSite', 'itemId' => $it ) );
		}
		$wo = id();
		eq( array( 'ok' => true, 'applied' => true, 'woNo' => 1 ), cmd( array( 'type' => 'escalate', 'itemId' => $items[0], 'woId' => $wo ) ) );
		eq( 'grounds', Azl_Db::val( 'SELECT dept FROM ' . Azl_Db::t( 'work_orders' ) . ' WHERE id = %s', array( $wo ) ) );
		eq( array( 'ok' => false, 'error' => Azl_Commands::ESCALATE_ONLY ), cmd( array( 'type' => 'escalate', 'itemId' => $items[1], 'woId' => id() ) ), 'maintenance has no repairs flag' );
		// Engineering stops handling repairs: no new escalation; the open Grounds work order keeps working.
		$off = edited(
			'departments',
			'engineering',
			static function ( $x ) {
				return array( 'repairs' => false ) + $x;
			}
		);
		eq( 200, save_list( 'departments', $off )[0] );
		eq( array( 'ok' => false, 'error' => Azl_Commands::ESCALATE_ONLY ), cmd( array( 'type' => 'escalate', 'itemId' => $items[2], 'woId' => id() ) ) );
		// With a work order open, the last active repairs departments cannot all lose the flag or be archived.
		$none = array_map(
			static function ( $x ) {
				return array( 'repairs' => false ) + $x;
			},
			Azl_Catalog::get()['departments']
		);
		eq( array( 409, 'azl_in_use', '1 open work order need a department that handles repairs. Keep at least one active one.' ), refusal( save_list( 'departments', $none ) ) );
		// Grounds is archived (its type first): the existing work order still moves through assess, start and complete.
		eq( 200, save_list( 'requestTypes', edited( 'requestTypes', 'broken_bench', 'archived' ) )[0] );
		eq( 200, save_list( 'departments', edited( 'departments', 'grounds', 'archived' ) )[0], 'IT still handles repairs' );
		has( array( 'ok' => true ), cmd( array( 'type' => 'assessWo', 'woId' => $wo, 'assessment' => 'Replace slat', 'assignType' => 'inhouse', 'estCost' => 500 ) ) );
		has( array( 'ok' => true ), cmd( array( 'type' => 'startWo', 'woId' => $wo ) ) );
		has( array( 'ok' => true ), cmd( array( 'type' => 'completeWo', 'woId' => $wo, 'actualCost' => 450 ) ) );
		eq( 'done', item_row( $items[0] )['status'], 'completing closes the escalated item' );
		// No open work orders left: zero repairs departments is allowed.
		$none = array_map(
			static function ( $x ) {
				return array( 'repairs' => false ) + $x;
			},
			Azl_Catalog::get()['departments']
		);
		eq( 200, save_list( 'departments', $none )[0] );
		// A catalog stored before the flag existed gets the factory value.
		$old = Azl_Catalog::seed();
		foreach ( $old['departments'] as $i => $d ) {
			unset( $old['departments'][ $i ]['repairs'] );
		}
		update_option( Azl_Catalog::OPTION, wp_json_encode( $old ) );
		eq( array( 'engineering', 'it' ), array_values( array_column( array_filter( Azl_Catalog::get()['departments'], static function ( $d ) { return $d['repairs']; } ), 'key' ) ) );
	}
);
