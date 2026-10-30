<?php
/**
 * The Configuration page's server side: the list definitions (catalog.defs), every module list end to end through the
 * REST layer, the hotel profile, and the wave 3 integration fixes (acting staff id, report-only work orders, the
 * module refusal hook, checkout time on the checkout rule, idempotent module seeds).
 */

/** The module lists the Configuration page edits with the generic editor, and a record-making command for those that records reference. */
const CFG_MODULE_LISTS = array( 'woAreas', 'cleaningTypes', 'vehicles', 'crisisCodes', 'complaintCategories', 'crisisLocations', 'involvedTypes' );

/** PUT /catalog/<list> through Azl_Rest as the signed-in account. @return array{0: int, 1: array} */
function cfg_put( string $list, array $items, ?int $rev = null ): array {
	$r = new WP_REST_Request( 'PUT' );
	$r->set_param( 'list', $list );
	$r->set_body( json_encode( array( 'items' => $items, 'baseRev' => $rev ?? Azl_Catalog::get()['catalogRev'] ) ) );
	$out = Azl_Rest::put_catalog( $r );
	return array( $out->get_status(), $out->get_data() );
}

/** PUT /profile as the signed-in account (after the permission check, like WordPress). @return array{0: int, 1: array} */
function cfg_profile( array $body ): array {
	if ( ! Azl_Rest::can_manage_profile() ) {
		return array( 403, array( 'code' => 'rest_forbidden' ) );
	}
	$r = new WP_REST_Request( 'PUT' );
	$r->set_body( json_encode( $body ) );
	$out = Azl_Profile::rest_put( $r );
	return array( $out->get_status(), $out->get_data() );
}

function cfg_def( string $list ): array {
	foreach ( Azl_Catalog::defs() as $d ) {
		if ( $d['key'] === $list ) {
			return $d;
		}
	}
	throw new Azl_Assert_Failed( "no def for $list" );
}

/** A record that stores this module list's first seeded key. */
function cfg_use( string $list, string $key ): void {
	$made = array(
		'vehicles'            => array( 'type' => 'logTrip', 'tripId' => id(), 'vehicle' => $key, 'dest' => 'Airport' ),
		'cleaningTypes'       => array( 'type' => 'logClean', 'taskId' => id(), 'room' => '201', 'cleanType' => $key, 'attendantId' => JOEL, 'role' => 'lead', 'clockIn' => true ),
		'crisisCodes'         => array( 'type' => 'logCrisis', 'caseId' => id(), 'code' => $key ),
		'complaintCategories' => array( 'type' => 'logCrisis', 'caseId' => id(), 'code' => 'guest_complaint', 'category' => $key ),
		'crisisLocations'     => array( 'type' => 'logCrisis', 'caseId' => id(), 'code' => 'earthquake', 'location' => $key ),
		'involvedTypes'       => array( 'type' => 'logCrisis', 'caseId' => id(), 'code' => 'earthquake', 'whoType' => $key ),
	)[ $list ];
	has( array( 'ok' => true, 'applied' => true ), cmd( $made ), "a record using $list/$key" );
}

/* ---------- definitions ---------- */

test(
	'configuration: catalog.defs describes every list, built-in and module, in GET /catalog and the snapshot',
	function () {
		$defs = Azl_Catalog::defs();
		eq( Azl_Catalog::lists(), array_column( $defs, 'key' ), 'one def per list, built-in first' );
		foreach ( CFG_MODULE_LISTS as $list ) {
			ok( in_array( $list, Azl_Catalog::lists(), true ), "$list is a list" );
		}
		eq(
			array( 'key' => 'departments', 'label' => 'Departments', 'noun' => array( 'department', 'departments' ), 'help' => Azl_Catalog::META['departments'][1], 'maxItems' => 40, 'fields' => array( array( 'name' => 'short', 'label' => 'badge', 'type' => 'text', 'max' => 6, 'required' => true ), array( 'name' => 'repairs', 'label' => 'handles repairs', 'type' => 'bool', 'default' => false ) ) ),
			cfg_def( 'departments' )
		);
		eq( array( 'dept', 'slaMin', 'icon' ), array_column( cfg_def( 'requestTypes' )['fields'], 'name' ) );
		eq( 'Service items', cfg_def( 'requestTypes' )['label'], 'the prototype\'s wording' );
		eq( array(), cfg_def( 'jobTitles' )['fields'] );
		eq(
			array( 'key' => 'vehicles', 'label' => 'Vehicles', 'noun' => array( 'vehicle', 'vehicles' ), 'help' => Azl_Catalog::META['vehicles'][1], 'maxItems' => 30, 'fields' => array(), 'module' => 'transport', 'usedBy' => array( 'trip', 'trips' ) ),
			cfg_def( 'vehicles' )
		);
		eq( array( array( 'name' => 'code', 'label' => 'radio code', 'type' => 'text', 'max' => 8, 'required' => true ), array( 'name' => 'complaint', 'label' => 'guest complaint', 'type' => 'bool', 'default' => false ) ), cfg_def( 'crisisCodes' )['fields'] );
		eq( 'workorders', cfg_def( 'woAreas' )['module'] );
		ok( ! isset( cfg_def( 'woAreas' )['usedBy'] ), 'areas are copied into work orders as text: nothing blocks deleting one' );
		foreach ( array( 'cleaningTypes', 'crisisCodes', 'complaintCategories', 'crisisLocations', 'involvedTypes' ) as $list ) {
			ok( isset( cfg_def( $list )['usedBy'] ), "$list names the records that use it" );
		}
		// Sent with the lists: the snapshot and GET /catalog, never stored.
		eq( $defs, Azl_Snapshot::load()['catalog']['defs'] );
		$got = Azl_Rest::catalog( new WP_REST_Request( 'GET' ) )->get_data();
		eq( $defs, $got['catalog']['defs'] );
		ok( ! isset( json_decode( get_option( Azl_Catalog::OPTION ), true )['defs'] ), 'defs are not stored' );
		eq( array( 'departments', 'holdReasons', 'openWorkOrders', 'lists' ), array_keys( $got['usage'] ) );
	}
);

test(
	'configuration: a module cannot declare a list named defs or catalogRev',
	function () {
		$m = new class() extends Azl_Module {
			public function id(): string {
				return 'cfgbad';
			}
			public function catalogLists(): array {
				return array( 'defs' => array( 'label' => array( 'def', 'defs' ), 'seed' => array() ) );
			}
		};
		try {
			Azl_Modules::register( $m );
			Azl_Modules::forget( 'cfgbad' );
			ok( false, 'registered' );
		} catch ( InvalidArgumentException $e ) {
			ok( false !== strpos( $e->getMessage(), 'list defs' ), 'refused: ' . $e->getMessage() );
		}
	}
);

/* ---------- every module list through REST ---------- */

test(
	'configuration: every module list through PUT /catalog: add, rename, reorder, archive, restore, delete, stale and permissions',
	function () {
		cast();
		foreach ( array( SUP_ID, PHONE_ID, SUB_ID ) as $id ) {
			as_user( $id );
			ok( ! Azl_Rest::can_manage_lists(), "user $id may not change lists" );
		}
		ok( Azl_Rest::can_use_desk() || SUB_ID === get_current_user_id(), 'readers' );
		as_user( MGR_ID );
		ok( Azl_Rest::can_manage_lists(), 'a manager changes lists' );
		foreach ( CFG_MODULE_LISTS as $list ) {
			$seed = Azl_Catalog::get()[ $list ];
			ok( count( $seed ) > 2, "$list is seeded" );
			$def   = cfg_def( $list );
			$extra = array();
			foreach ( $def['fields'] as $f ) {
				$extra[ $f['name'] ] = 'bool' === $f['type'] ? false : 'X1';
			}
			// Add one (the key comes from the label), rename the first, move the last to the top.
			$items                = $seed;
			$items[0]['label']    = 'Renamed ' . $list;
			$items[]              = array( 'label' => 'Brand new' ) + $extra;
			$items                = array_merge( array( array_pop( $items ) ), $items );
			list( $status, $out ) = cfg_put( $list, $items );
			eq( 200, $status, "$list saved: " . json_encode( $out ) );
			$saved = $out['catalog'][ $list ];
			eq( 'brand_new', $saved[0]['key'], "$list new key" );
			eq( array( $seed[0]['key'], 'Renamed ' . $list ), array( $saved[1]['key'], $saved[1]['label'] ), "$list rename keeps the key" );
			ok( isset( $out['catalog']['defs'] ), "$list: the answer carries defs" );
			// Archive and restore.
			$saved[1]['active'] = false;
			eq( 200, cfg_put( $list, $saved )[0] );
			eq( false, Azl_Catalog::get()[ $list ][1]['active'], "$list archived" );
			$saved[1]['active'] = true;
			eq( 200, cfg_put( $list, $saved )[0] );
			// Delete an unused one.
			array_shift( $saved );
			eq( 200, cfg_put( $list, $saved )[0], "$list delete unused" );
			eq( count( $seed ), count( Azl_Catalog::get()[ $list ] ) );
			// Stale: an editor loaded before the last save.
			list( $status, $out ) = cfg_put( $list, $saved, Azl_Catalog::get()['catalogRev'] - 1 );
			eq( array( 409, 'azl_stale' ), array( $status, $out['code'] ), "$list stale" );
			ok( isset( $out['catalog']['defs'] ), 'the fresh lists come back with defs' );
			// Validation: an empty name, a duplicate, too many.
			eq( 'Enter a name of 1 to 40 characters.', cfg_put( $list, array_merge( $saved, array( array( 'label' => ' ' ) + $extra ) ) )[1]['error'] );
			eq( "\u{201C}renamed $list\u{201D} is already in this list.", cfg_put( $list, array_merge( $saved, array( array( 'label' => 'renamed ' . $list ) + $extra ) ) )[1]['error'] );
			eq( 400, cfg_put( $list, array_fill( 0, $def['maxItems'] + 1, array( 'label' => 'x' ) + $extra ) )[0], "$list max" );
		}
		// A required field of a module list (the radio code).
		$codes                = Azl_Catalog::get()['crisisCodes'];
		$codes[0]['code']     = '';
		eq( array( 400, 'Enter the radio code.' ), array( cfg_put( 'crisisCodes', $codes )[0], cfg_put( 'crisisCodes', $codes )[1]['error'] ) );
	}
);

test(
	'configuration: a module list entry that records use cannot be deleted (archive instead); usage counts them',
	function () {
		cast();
		as_user( MGR_ID );
		foreach ( array( 'vehicles', 'cleaningTypes', 'crisisCodes', 'complaintCategories', 'crisisLocations', 'involvedTypes' ) as $list ) {
			$all  = Azl_Catalog::get()[ $list ];
			$used = 'crisisCodes' === $list ? 'fire' : $all[0]['key'];
			if ( 'crisisLocations' === $list || 'involvedTypes' === $list || 'complaintCategories' === $list ) {
				$used = $all[1]['key'];
			}
			as_user( 0 );
			cfg_use( $list, $used );
			as_user( MGR_ID );
			$n = (int) ( (array) ( (array) Azl_Catalog::usage()['lists'] )[ $list ] )[ $used ];
			ok( $n >= 1, "$list usage counted" );
			$label = Azl_Catalog::find( Azl_Catalog::get(), $list, $used )['label'];
			$noun  = cfg_def( $list )['usedBy'];
			$rest  = array_values(
				array_filter(
					$all,
					static function ( $x ) use ( $used ) {
						return $x['key'] !== $used;
					}
				)
			);
			list( $status, $out ) = cfg_put( $list, $rest );
			eq( array( 409, 'azl_in_use', "$label is used by $n " . ( 1 === $n ? $noun[0] : $noun[1] ) . '. Archive it instead.', $used ), array( $status, $out['code'], $out['error'], $out['key'] ), $list );
			$archived = array_map(
				static function ( $x ) use ( $used ) {
					return $x['key'] === $used ? array( 'active' => false ) + $x : $x;
				},
				$all
			);
			eq( 200, cfg_put( $list, $archived )[0], "$list archived while in use" );
		}
		// Areas are copied as text: one in use by a work order can still be deleted, and the work order keeps its area.
		as_user( 0 );
		has( array( 'ok' => true ), cmd( wot_report( array( 'area' => 'Office' ) ) ) );
		as_user( MGR_ID );
		$areas = array_values(
			array_filter(
				Azl_Catalog::get()['woAreas'],
				static function ( $x ) {
					return 'Office' !== $x['label'];
				}
			)
		);
		eq( 200, cfg_put( 'woAreas', $areas )[0] );
		eq( 'Office', Azl_Db::val( 'SELECT area FROM ' . Azl_Db::t( 'work_orders' ) ) );
	}
);

/* ---------- hotel profile ---------- */

if ( ! function_exists( 'absint' ) ) {
	function absint( $v ) { // WordPress core, for Azl_Admin::sanitize
		return abs( (int) $v );
	}
}

test(
	'configuration: the hotel profile is read by every desk role and edited by the owner only; it lives in azl_settings',
	function () {
		cast();
		update_option( 'azl_settings', array( 'property_name' => 'Azalea Baguio', 'rooms' => array( '101' ), 'poll_seconds' => 7 ) );
		$matrix = array( ADMIN_ID => true, OWNER_ID => true, MGR_ID => false, SUP_ID => false, PHONE_ID => false, SUB_ID => false );
		foreach ( $matrix as $id => $can ) {
			as_user( $id );
			eq( $can, Azl_Rest::can_manage_profile(), "user $id edits the profile" );
		}
		Azl_Rest::register_routes();
		$routes = $GLOBALS['azl_wp']['routes'];
		eq( array( Azl_Rest::class, 'can_manage_profile' ), $routes['azl-ehd/v1/profile']['permission_callback'], 'the last /profile registration is PUT' );
		as_user( SUP_ID );
		eq( array( 'ok' => true, 'profile' => array( 'name' => 'Azalea Baguio', 'short' => '', 'contact' => '', 'address' => '', 'timeZone' => 'Asia/Manila' ) ), Azl_Profile::rest_get( new WP_REST_Request( 'GET' ) )->data );
		eq( 403, cfg_profile( array( 'name' => 'Hacked' ) )[0], 'a supervisor cannot' );
		as_user( MGR_ID );
		eq( 403, cfg_profile( array( 'name' => 'Hacked' ) )[0], 'a manager cannot' );
		as_user( OWNER_ID );
		$rev = Azl_Db::counter( 'change' );
		list( $status, $out ) = cfg_profile( array( 'name' => ' Azalea  Boutique <b>Baguio</b> ', 'short' => 'Azalea BAG', 'contact' => '+63 74 123 4567', 'address' => '108 Leonard Wood Rd, Baguio' ) );
		eq( 200, $status );
		eq( array( 'name' => 'Azalea Boutique Baguio', 'short' => 'Azalea BAG', 'contact' => '+63 74 123 4567', 'address' => '108 Leonard Wood Rd, Baguio', 'timeZone' => 'Asia/Manila' ), $out['profile'] );
		eq( $rev + 1, Azl_Db::counter( 'change' ), 'phones refresh' );
		$s = get_option( 'azl_settings' );
		eq( array( '101' ), $s['rooms'], 'other settings are kept' );
		eq( 7, $s['poll_seconds'] );
		eq( 'Azalea Boutique Baguio', Azl_Snapshot::property()['name'], 'the name every page prints' );
		eq( 'Azalea Boutique Baguio', Azl_Admin::settings()['property_name'], 'the wp-admin Settings page shows the same name' );
		// Validation, nothing written.
		$before = get_option( 'azl_settings' );
		eq( array( 400, 'Enter the hotel name.', 'name' ), array( cfg_profile( array( 'name' => '  ' ) )[0], cfg_profile( array( 'name' => '' ) )[1]['error'], cfg_profile( array( 'name' => '' ) )[1]['field'] ) );
		eq( 'Keep the short name to 20 characters.', cfg_profile( array( 'name' => 'A', 'short' => str_repeat( 'x', 21 ) ) )[1]['error'] );
		eq( 'Keep the address to 200 characters.', cfg_profile( array( 'name' => 'A', 'address' => str_repeat( 'x', 201 ) ) )[1]['error'] );
		eq( 'Enter the contact as text.', cfg_profile( array( 'name' => 'A', 'contact' => 5 ) )[1]['error'] );
		eq( 400, cfg_profile( array() )[0] );
		eq( $before, get_option( 'azl_settings' ) );
		// The wp-admin Settings page keeps the profile fields it does not show.
		$clean = Azl_Admin::sanitize( array( 'property_name' => 'From wp-admin', 'rooms' => "101\n102" ) );
		eq( array( 'Azalea BAG', '+63 74 123 4567', '108 Leonard Wood Rd, Baguio' ), array( $clean['property_short'], $clean['property_contact'], $clean['property_address'] ) );
	}
);

/* ---------- integration fixes ---------- */

test(
	'configuration: (b) staff of a department that does not handle repairs may report a work order, not act on others',
	function () {
		$hk = array( 'kind' => 'staff', 'dept' => 'housekeeping', 'staff' => JOEL );
		eq( 'read', Azl_Access::level( 'workorders', $hk ) );
		eq( null, Azl_Access::refusal( array( 'type' => 'reportWo' ), $hk ), 'report' );
		foreach ( array( 'assessWo', 'startWo', 'editWo', 'updateWo', 'openWo' ) as $type ) {
			eq( 'You can report a new one in Work Orders, but only the help desk or the team that handles it can change it.', Azl_Access::refusal( array( 'type' => $type ), $hk ), $type );
		}
		eq( 'Your role can only view House Status.', Azl_Access::refusal( array( 'type' => 'logHouse' ), $hk ), 'read elsewhere still reads' );
		eq( 'Your role cannot use Inquiries.', Azl_Access::refusal( array( 'type' => 'logInquiry' ), $hk ) );
	}
);

test(
	'configuration: (c) a module words its own refusal for own access (Transport), others keep the department message',
	function () {
		$hk = array( 'kind' => 'staff', 'dept' => 'housekeeping', 'staff' => JOEL );
		foreach ( array( 'logTrip', 'scheduleTrip', 'editTrip', 'cancelTrip' ) as $type ) {
			eq( Azl_Module_Transport::DESK_ONLY, Azl_Access::refusal( array( 'type' => $type, 'tripId' => id() ), $hk ), $type );
		}
		eq( null, Azl_Access::refusal( array( 'type' => 'departTrip', 'tripId' => id() ), $hk ), 'a driver departs: the module checks the trip' );
		eq( null, Azl_Access::refusal( array( 'type' => 'logTrip', 'tripId' => id() ), array( 'kind' => 'hdo', 'dept' => 'frontdesk', 'staff' => MARIA ) ) );
		$trips = (int) Azl_Db::val( 'SELECT COUNT(*) FROM ' . Azl_Db::t( 'trips' ) );
		access_accounts();
		$GLOBALS['azl_wp']['user'] = ACC_PHONE;
		eq( array( 'ok' => false, 'error' => Azl_Module_Transport::DESK_ONLY ), cmd( array( 'type' => 'logTrip', 'tripId' => id(), 'vehicle' => 'van_1', 'dest' => 'Airport' ), JOEL ) );
		eq( $trips, (int) Azl_Db::val( 'SELECT COUNT(*) FROM ' . Azl_Db::t( 'trips' ) ), 'nothing written' );
		eq( null, ( new Azl_Module_Cleaning() )->ownRefusal( 'logClean' ), 'the default hook says nothing' );
	}
);

test(
	'configuration: (a) commands and snapshots see the acting staff id in who',
	function () {
		$probe = new class() extends Azl_Module {
			public function id(): string {
				return 'cfgprobe';
			}
			public function capabilities(): array {
				return array( 'owner' => 'full', 'manager' => 'full', 'supervisor' => 'full', 'hdo' => 'full', 'staff' => 'full' );
			}
			public function commands(): array {
				return array(
					'cfgProbe' => array(
						'run' => static function ( array $cmd, Azl_Commands $ctx ): array {
							return Azl_Commands::ok( array( 'who' => $ctx->who() ) );
						},
					),
				);
			}
		};
		Azl_Modules::register( $probe );
		try {
			access_accounts();
			$GLOBALS['azl_wp']['user'] = ACC_PHONE;
			eq( array( 'kind' => 'staff', 'dept' => 'housekeeping', 'staff' => JOEL ), cmd( array( 'type' => 'cfgProbe' ), strtoupper( JOEL ) )['who'], 'a command' );
			$GLOBALS['azl_wp']['user'] = ACC_MANAGER;
			eq( array( 'kind' => 'manager', 'dept' => null, 'staff' => null ), cmd( array( 'type' => 'cfgProbe' ), null )['who'], 'an account acting as itself' );
		} finally {
			Azl_Modules::forget( 'cfgprobe' );
		}
	}
);

test(
	'configuration: (d) the checkout rule stamps the ready cleaning task with the checkout time, keeping an earlier one',
	function () {
		$fresh = clean_task( '640', 'scheduled' );
		$kept  = clean_task( '640', 'queued' );
		Azl_Db::update( 'clean_tasks', array( 'checkout_at' => 1234 ), array( 'id' => $kept ) );
		$other           = clean_task( '641', 'queued' );
		list( , $items ) = logged( '640', array( 'inspection' ) );
		azl_advance( 5000 );
		cmd( array( 'type' => 'finish', 'itemId' => $items[0], 'status' => 'done' ) );
		$row = static function ( string $id ): array {
			return Azl_Db::row( 'SELECT status, checkout_at FROM ' . Azl_Db::t( 'clean_tasks' ) . ' WHERE id = %s', array( $id ) );
		};
		eq( array( 'status' => 'ready', 'checkout_at' => Azl_Db::now() ), array_map( 'intval_or_status', $row( $fresh ) ) );
		eq( 1234, (int) $row( $kept )['checkout_at'] );
		eq( array( 'queued', null ), array_values( $row( $other ) ) );
		$sent = array_column( Azl_Snapshot::load()['cleaning'], 'checkoutAt', 'id' );
		eq( Azl_Db::now(), $sent[ $fresh ] ?? null, 'the snapshot sends it' );
		// A cancelled ("cant") item never readies the room.
		$late            = clean_task( '642', 'scheduled' );
		list( , $items ) = logged( '642', array( 'inspection' ) );
		cmd( array( 'type' => 'finish', 'itemId' => $items[0], 'status' => 'cant' ) );
		eq( array( 'scheduled', null ), array_values( $row( $late ) ) );
	}
);

function intval_or_status( $v ) {
	return is_numeric( $v ) ? (int) $v : $v;
}

test(
	'configuration: (e) module list seeds never overwrite the hotel\'s edits: re-registering, upgrading or re-reading keeps them',
	function () {
		cast();
		as_user( MGR_ID );
		Azl_Catalog::get(); // stored on first read
		$v = Azl_Catalog::get()['vehicles'];
		$v[0]['label'] = 'Toyota HiAce';
		array_pop( $v ); // Shuttle gone
		$v[] = array( 'label' => 'Tuk-tuk' );
		eq( 200, cfg_put( 'vehicles', $v )[0] );
		eq( 200, cfg_put( 'involvedTypes', array() )[0], 'a list may be emptied' );
		$codes                 = Azl_Catalog::get()['crisisCodes'];
		$codes[0]['complaint'] = true;
		eq( 200, cfg_put( 'crisisCodes', $codes )[0] );
		$want = Azl_Catalog::get();
		// The module is registered again (a plugin update), the schema upgrade runs, the cache is cleared.
		foreach ( array( 'transport', 'crisis' ) as $id ) {
			$m = Azl_Modules::get( $id );
			Azl_Modules::forget( $id );
			Azl_Modules::register( $m );
		}
		delete_option( 'azl_db_version' );
		Azl_Schema::maybe_upgrade();
		eq( $want, Azl_Catalog::get(), 'every list as the hotel left it' );
		eq( array( 'van_1', 'van_2', 'tuk_tuk' ), array_column( Azl_Catalog::get()['vehicles'], 'key' ) );
		eq( array(), Azl_Catalog::get()['involvedTypes'], 'an emptied list stays empty' );
		eq( $want, Azl_Catalog::locked(), 'a locked read too' );
		// A list missing from the stored lists (a module added later) is seeded once, the same way every time, and
		// stored with the next save of any list.
		$stored = json_decode( get_option( Azl_Catalog::OPTION ), true );
		unset( $stored['woAreas'] );
		update_option( Azl_Catalog::OPTION, wp_json_encode( $stored ) );
		$a = Azl_Catalog::get()['woAreas'];
		eq( 8, count( $a ) );
		eq( $a, Azl_Catalog::get()['woAreas'], 'the same seed each read' );
		eq( 200, cfg_put( 'jobTitles', Azl_Catalog::get()['jobTitles'] )[0] );
		eq( $a, json_decode( get_option( Azl_Catalog::OPTION ), true )['woAreas'], 'stored with the next save' );
		eq( 'Toyota HiAce', json_decode( get_option( Azl_Catalog::OPTION ), true )['vehicles'][0]['label'] );
	}
);
