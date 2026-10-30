<?php
/**
 * The module framework (Azl_Module, Azl_Modules) end to end with the tests-only example module, the additive
 * schema upgrade, snapshot slices by access, module lists in the catalog, and azl_updates.
 */

require_once __DIR__ . '/../fixtures/ExampleModule.php';

/**
 * Registers the example module ALONE for one test body (the real modules step aside, so these framework tests do
 * not depend on which modules ship) and always puts the registry back (it outlives a test).
 */
function with_example( callable $fn, ?Azl_Module_Example $m = null ): void {
	$m     = $m ?? new Azl_Module_Example();
	$aside = Azl_Modules::all();
	foreach ( array_keys( $aside ) as $id ) {
		Azl_Modules::forget( $id );
	}
	Azl_Modules::register( $m );
	try {
		$fn( $m );
	} finally {
		Azl_Modules::forget( 'example' );
		foreach ( $aside as $mod ) {
			Azl_Modules::register( $mod );
		}
	}
}

function table_exists( string $name ): bool {
	return null !== Azl_Db::val( "SELECT name FROM sqlite_master WHERE type = 'table' AND name = %s", array( Azl_Db::t( $name ) ) );
}

function example_rows(): array {
	return Azl_Db::rows( 'SELECT * FROM ' . Azl_Db::t( 'example_notes' ) . ' ORDER BY note_no' );
}

test(
	'modules: the example module end to end: table and counter, a command with a number, its note, the snapshot slice, replay',
	function () {
		with_example(
			function () {
				Azl_Schema::maybe_upgrade(); // a new module upgrades the database once
				ok( table_exists( 'example_notes' ), 'module table created' );
				eq( Azl_Schema::VERSION . '+example@1', get_option( 'azl_db_version' ) );
				eq( 0, Azl_Db::counter( 'ex' ) );
				$note = id();
				$c    = array( 'type' => 'addExampleNote', 'noteId' => $note, 'text' => 'Lobby plant <b>wilting</b>', 'opId' => id() );
				$r    = cmd( $c );
				eq( array( 'ok' => true, 'applied' => true, 'noteNo' => 1 ), $r );
				eq( 1, Azl_Db::counter( 'change' ), 'the poll counter moved' );
				eq( array( 'Noted' ), labels( $note ) );
				$rows   = example_rows();
				$before = array( fingerprint(), $rows );
				azl_advance( 1000 );
				eq( array( 'ok' => true, 'applied' => false, 'noteNo' => 1 ), cmd( $c ), 'a replay answers with the same number' );
				eq( $before, array( fingerprint(), example_rows() ), 'and changes nothing' );
				$snap = json_decode( json_encode( Azl_Snapshot::load( array( 'kind' => 'owner', 'dept' => null ) ) ), true );
				eq(
					array( 'notes' => array( array( 'id' => $note, 'no' => 'EX-0001', 'text' => 'Lobby plant wilting', 'status' => 'open', 'updates' => array( array( 'at' => Azl_Db::now() - 1000, 'by' => MARIA, 'text' => 'First look: Lobby plant wilting' ) ) ) ) ),
					$snap['modules']['example']
				);
				eq( array( 'ok' => false, 'error' => 'Write the note' ), cmd( array( 'type' => 'addExampleNote', 'noteId' => id(), 'text' => '  ' ) ), 'its validation runs first' );
				eq( array( 'ok' => false, 'error' => 'Invalid id' ), cmd( array( 'type' => 'addExampleNote', 'noteId' => 'nope', 'text' => 'x' ) ), 'its ids are checked' );
				eq( array( 'ok' => false, 'error' => 'Invalid id' ), cmd( array( 'type' => 'closeExampleNote' ) ), 'and required' );
				has( array( 'ok' => true, 'applied' => true ), cmd( array( 'type' => 'closeExampleNote', 'noteId' => $note ) ) );
				eq( 'closed', example_rows()[0]['status'] );
			}
		);
		eq( array( 'ok' => false, 'error' => 'Unknown command' ), cmd( array( 'type' => 'addExampleNote', 'noteId' => id(), 'text' => 'x' ) ), 'gone with its module' );
	}
);

test(
	'modules: the upgrade is additive: an existing version 1 database keeps its data and gains the new tables and counters',
	function () {
		list( $request ) = logged( '931', array( 'towels' ) );
		// What a 0.3.0 site has: no azl_updates, none of the new counters, version 1.
		$GLOBALS['wpdb']->pdo->exec( 'DROP TABLE ' . Azl_Db::t( 'updates' ) );
		Azl_Db::exec( 'DELETE FROM ' . Azl_Db::t( 'seq' ) . " WHERE name IN ('inq', 'hs', 'cr', 'tr')" );
		update_option( 'azl_db_version', '1' );
		$data = array( Azl_Db::rows( 'SELECT * FROM ' . Azl_Db::t( 'requests' ) ), Azl_Db::rows( 'SELECT * FROM ' . Azl_Db::t( 'items' ) ), Azl_Db::counter( 'ticket' ) );
		with_example(
			function ( $m ) use ( $data, $request ) {
				Azl_Schema::maybe_upgrade();
				ok( table_exists( 'updates' ) && table_exists( 'example_notes' ), 'new tables' );
				eq( array( 'catalog', 'change', 'cr', 'ex', 'hs', 'inc', 'inq', 'ticket', 'tr', 'wo' ), array_column( Azl_Db::rows( 'SELECT name FROM ' . Azl_Db::t( 'seq' ) . ' ORDER BY name' ), 'name' ) );
				eq( $data, array( Azl_Db::rows( 'SELECT * FROM ' . Azl_Db::t( 'requests' ) ), Azl_Db::rows( 'SELECT * FROM ' . Azl_Db::t( 'items' ) ), Azl_Db::counter( 'ticket' ) ), 'existing data untouched' );
				cmd( array( 'type' => 'addExampleNote', 'noteId' => id(), 'text' => 'one' ) );
				$m->ver = '2'; // the module changed its tables: one more upgrade, which keeps its rows
				ok( Azl_Schema::VERSION . '+example@2' !== get_option( 'azl_db_version' ), 'version differs' );
				Azl_Schema::maybe_upgrade();
				eq( Azl_Schema::VERSION . '+example@2', get_option( 'azl_db_version' ) );
				eq( 1, count( example_rows() ) );
				eq( 1, Azl_Db::counter( 'ex' ), 'counters are never reset' );
				ok( null !== Azl_Db::val( 'SELECT id FROM ' . Azl_Db::t( 'requests' ) . ' WHERE id = %s', array( $request ) ), 'request still there' );
			}
		);
	}
);

test(
	'modules: a module cannot drop, alter or take what exists; its id, commands and lists must be new',
	function () {
		$bad = static function ( string $sql ): Azl_Module_Example {
			return new class( $sql ) extends Azl_Module_Example {
				private $sql;
				public function __construct( string $sql ) {
					$this->sql = $sql;
				}
				public function schema() {
					return $this->sql;
				}
			};
		};
		$t = Azl_Db::t( 'x_notes' );
		foreach (
			array(
				'DROP TABLE ' . Azl_Db::t( 'items' ),
				'ALTER TABLE ' . Azl_Db::t( 'items' ) . ' ADD x int',
				'CREATE TABLE wp_users (id int, PRIMARY KEY  (id))',
				'CREATE TABLE ' . Azl_Db::t( 'items' ) . ' (id int, PRIMARY KEY  (id))',
				"CREATE TABLE $t (id int, PRIMARY KEY  (id)); DROP TABLE " . Azl_Db::t( 'staff' ) . ';',
				"CREATE TABLE $t (id int, PRIMARY KEY  (id)) AS SELECT * FROM " . Azl_Db::t( 'staff' ) . '; DELETE FROM x;',
			) as $sql
		) {
			$threw = false;
			try {
				Azl_Modules::register( $bad( $sql ) );
			} catch ( InvalidArgumentException $e ) {
				$threw = true;
			}
			Azl_Modules::forget( 'example' );
			ok( $threw, "refused: $sql" );
		}
		with_example(
			function () {
				$threw = false;
				try {
					Azl_Modules::register( new Azl_Module_Example() );
				} catch ( InvalidArgumentException $e ) {
					$threw = false !== strpos( $e->getMessage(), 'already registered' );
				}
				ok( $threw, 'the same id twice' );
			}
		);
		$taken = new class() extends Azl_Module {
			public function id(): string {
				return 'taker';
			}
			public function commands(): array {
				return array( 'relay' => array( 'run' => 'strlen' ) );
			}
		};
		$threw = false;
		try {
			Azl_Modules::register( $taken );
		} catch ( InvalidArgumentException $e ) {
			$threw = true;
		}
		ok( $threw && null === Azl_Modules::get( 'taker' ), 'a built-in command name' );
	}
);

test(
	'modules: snapshot slices and commands follow the module\'s access; read is refused for changes',
	function () {
		with_example(
			function () {
				Azl_Schema::maybe_upgrade();
				access_accounts();
				$note = id();
				cmd( array( 'type' => 'addExampleNote', 'noteId' => $note, 'text' => 'Gate light out' ) );
				$slices = static function ( array $who ): array {
					return array_keys( json_decode( json_encode( Azl_Snapshot::load( $who ) ), true )['modules'] );
				};
				eq( array( 'example' ), $slices( array( 'kind' => 'manager', 'dept' => null ) ) );
				eq( array( 'example' ), $slices( array( 'kind' => 'supervisor', 'dept' => null ) ), 'read access still reads' );
				eq( array(), $slices( array( 'kind' => 'staff', 'dept' => 'housekeeping' ) ), 'no slice without access' );
				eq( array(), $slices( array( 'kind' => 'none', 'dept' => null ) ) );
				$GLOBALS['azl_wp']['user'] = ACC_SUP;
				eq( array( 'ok' => false, 'error' => 'Your role can only view Example.' ), cmd( array( 'type' => 'addExampleNote', 'noteId' => id(), 'text' => 'x' ), null ) );
				$GLOBALS['azl_wp']['user'] = ACC_PHONE;
				has( array( 'ok' => true ), cmd( array( 'type' => 'addExampleNote', 'noteId' => id(), 'text' => 'by the desk officer' ), MARIA ), 'own may add' );
				eq( array( 'ok' => false, 'error' => 'Only a supervisor or manager can do this in Example.' ), cmd( array( 'type' => 'closeExampleNote', 'noteId' => $note ), MARIA ), 'need full' );
				eq( array( 'ok' => false, 'error' => 'Your role cannot use Example.' ), cmd( array( 'type' => 'addExampleNote', 'noteId' => id(), 'text' => 'x' ), JOEL ) );
				eq( 2, count( example_rows() ) );
				// REST: the snapshot follows the PIN person on a shared phone.
				$r = new WP_REST_Request( 'GET' );
				$r->set_header( 'X-Azl-Actor', Azl_Pin::sign_actor( ACC_PHONE, JOEL )['token'] );
				eq( '{}', json_encode( Azl_Rest::snapshot( $r )->get_data()['modules'] ) );
				$r->set_header( 'X-Azl-Actor', Azl_Pin::sign_actor( ACC_PHONE, MARIA )['token'] );
				eq( array( 'example' ), array_keys( (array) Azl_Rest::snapshot( $r )->get_data()['modules'] ) );
				eq( 'own', Azl_Access::matrix()['example']['hdo'], 'the desk gets the module row too' );
			}
		);
	}
);

test(
	'modules: a module list joins the hotel\'s lists, seeded, checked by its declared fields, saved like the others',
	function () {
		with_example(
			function () {
				$cat = Azl_Catalog::get();
				eq( array( array( 'key' => 'urgent', 'label' => 'Urgent', 'color' => 'red', 'active' => true ) ), $cat['exampleTags'] );
				ok( in_array( 'exampleTags', Azl_Catalog::lists(), true ), 'listed' );
				$rev = $cat['catalogRev'];
				eq( 400, Azl_Catalog::save( 'exampleTags', array( array( 'label' => 'Soon' ) ), $rev )[0], 'a required field' );
				eq( 'Enter the colour.', Azl_Catalog::save( 'exampleTags', array( array( 'label' => 'Soon' ) ), $rev )[1]['error'] );
				eq( 'Keep the colour under 10 characters.', Azl_Catalog::save( 'exampleTags', array( array( 'label' => 'Soon', 'color' => str_repeat( 'x', 11 ) ) ), $rev )[1]['error'] );
				eq( 'Keep the list to 3 tags.', Azl_Catalog::save( 'exampleTags', array_fill( 0, 4, array( 'label' => 'a', 'color' => 'b' ) ), $rev )[1]['error'] );
				list( $status, $out ) = Azl_Catalog::save( 'exampleTags', array( array( 'key' => 'urgent', 'label' => 'Urgent', 'color' => 'red', 'active' => false ), array( 'label' => 'Later', 'color' => 'grey', 'junk' => 1 ) ), $rev );
				eq( 200, $status );
				eq( array( array( 'key' => 'urgent', 'label' => 'Urgent', 'color' => 'red', 'active' => false ), array( 'key' => 'later', 'label' => 'Later', 'color' => 'grey', 'active' => true ) ), $out['catalog']['exampleTags'] );
				eq( $cat['departments'], $out['catalog']['departments'], 'other lists untouched' );
			}
		);
		eq( 404, Azl_Catalog::save( 'exampleTags', array(), 0 )[0], 'no module, no list' );
		ok( ! isset( Azl_Catalog::get()['exampleTags'] ) || is_array( Azl_Catalog::get()['exampleTags'] ), 'a stored module list is kept as data' );
	}
);

test(
	'updates: add and list progress notes; one note per op and record; bad input is refused',
	function () {
		$a  = id();
		$b  = id();
		$op = id();
		ok( Azl_Updates::add( 'work_order', $a, ' Parts ordered ', MARIA, $op, 1000 ), 'added' );
		ok( ! Azl_Updates::add( 'work_order', $a, 'Parts ordered', MARIA, $op, 2000 ), 'same op and record: nothing' );
		ok( Azl_Updates::add( 'work_order', $b, 'Same op, other record', null, $op, 1500 ), 'another record' );
		ok( Azl_Updates::add( 'work_order', $a, 'Fitted', strtoupper( RAMON ), id(), 3000 ), 'a new op' );
		eq(
			array(
				$a => array( array( 'at' => 1000, 'by' => MARIA, 'text' => 'Parts ordered' ), array( 'at' => 3000, 'by' => RAMON, 'text' => 'Fitted' ) ),
				$b => array( array( 'at' => 1500, 'by' => 'system', 'text' => 'Same op, other record' ) ),
			),
			Azl_Updates::list( 'work_order', array( $a, $b, 'not-a-uuid' ) )
		);
		eq( array(), Azl_Updates::list( 'house_log', array( $a ) ), 'per entity' );
		foreach ( array( array( 'Work Order', $a, 'x' ), array( 'work_order', 'nope', 'x' ), array( 'work_order', $a, '   ' ), array( 'work_order', $a, str_repeat( 'x', 2001 ) ) ) as $bad ) {
			$threw = false;
			try {
				Azl_Updates::add( $bad[0], $bad[1], $bad[2], null, id(), 1 );
			} catch ( InvalidArgumentException $e ) {
				$threw = true;
			}
			ok( $threw, 'refused ' . json_encode( array_slice( $bad, 0, 2 ) ) );
		}
	}
);
