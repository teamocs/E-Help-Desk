<?php
/**
 * Plain-PHP test runner: php azalea-ehelpdesk/tests/run.php [filter]
 *
 * Needs pdo_sqlite. When the PHP build has the extension but does not load it, this script runs
 * itself again with -d extension=pdo_sqlite.
 */

if ( ! extension_loaded( 'pdo_sqlite' ) ) {
	if ( getenv( 'AZL_TEST_CHILD' ) ) {
		fwrite( STDERR, "pdo_sqlite is not available in this PHP build.\n" );
		exit( 2 );
	}
	putenv( 'AZL_TEST_CHILD=1' );
	$azl_cmd = escapeshellarg( PHP_BINARY ) . ' -d extension=pdo_sqlite ' . escapeshellarg( __FILE__ );
	foreach ( array_slice( $argv, 1 ) as $azl_arg ) {
		$azl_cmd .= ' ' . escapeshellarg( $azl_arg );
	}
	passthru( $azl_cmd, $azl_code );
	exit( $azl_code );
}

require __DIR__ . '/bootstrap.php';

/* ---------- a very small test framework ---------- */

$GLOBALS['azl_tests'] = array();

function test( string $name, callable $fn ): void {
	$GLOBALS['azl_tests'][] = array( $name, $fn );
}

final class Azl_Assert_Failed extends Exception {}

function show( $v ): string {
	return is_string( $v ) ? var_export( $v, true ) : json_encode( $v, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
}

function eq( $expected, $actual, string $what = '' ): void {
	if ( $expected !== $actual ) {
		throw new Azl_Assert_Failed( ( '' === $what ? '' : "$what: " ) . 'expected ' . show( $expected ) . ', got ' . show( $actual ) );
	}
}

function ok( $cond, string $what ): void {
	if ( true !== $cond ) {
		throw new Azl_Assert_Failed( "not true: $what" );
	}
}

/** Every key in $subset is in $actual with the same value (like toMatchObject). */
function has( array $subset, $actual, string $what = '' ): void {
	if ( ! is_array( $actual ) ) {
		throw new Azl_Assert_Failed( ( '' === $what ? '' : "$what: " ) . 'expected an array, got ' . show( $actual ) );
	}
	foreach ( $subset as $k => $v ) {
		if ( ! array_key_exists( $k, $actual ) || $actual[ $k ] !== $v ) {
			throw new Azl_Assert_Failed( ( '' === $what ? '' : "$what: " ) . "key $k: expected " . show( $v ) . ', got ' . show( $actual[ $k ] ?? '(missing)' ) . ' in ' . show( $actual ) );
		}
	}
}

/* ---------- fixtures ---------- */

const MARIA  = 'a0a0a0a0-0000-4000-8000-000000000101'; // hdo, front desk
const JOEL   = 'a0a0a0a0-0000-4000-8000-000000000102'; // housekeeping
const RAMON  = 'a0a0a0a0-0000-4000-8000-000000000103'; // engineering, first in line
const DENNIS = 'a0a0a0a0-0000-4000-8000-000000000108'; // engineering, off shift

function id(): string {
	return Azl_Db::uuid();
}

function seed_staff(): void {
	$people = array(
		array( MARIA, 'Maria Santos', 'MS', 'hdo', 'Head Desk Officer', 'frontdesk', 1 ),
		array( JOEL, 'Joel Dizon', 'JD', 'staff', 'Room Attendant', 'housekeeping', 1 ),
		array( RAMON, 'Ramon Cruz', 'RC', 'staff', 'Engineer', 'engineering', 1 ),
		array( DENNIS, 'Dennis Lim', 'DL', 'staff', 'Night Engineer', 'engineering', 0 ),
	);
	foreach ( $people as $i => $p ) {
		Azl_Db::insert(
			'staff',
			array(
				'id'         => $p[0],
				'name'       => $p[1],
				'initials'   => $p[2],
				'role'       => $p[3],
				'title'      => $p[4],
				'dept'       => $p[5],
				'on_shift'   => $p[6],
				'active'     => 1,
				'pin_failed' => 0,
				'created_at' => 1_700_000_000_000 + $i,
				'updated_at' => 1_700_000_000_000 + $i,
			)
		);
	}
}

/** The account a command comes from when a test signed nobody in: a Hotel Owner (full access to every module). */
const TEST_OWNER = 1;

/** Applies a command as the signed-in account, or as TEST_OWNER when nobody is signed in. */
function apply_as_account( array $c, ?string $actor ): array {
	if ( 0 !== get_current_user_id() ) {
		return Azl_Commands::apply( $c, $actor );
	}
	$GLOBALS['azl_wp']['caps'][ TEST_OWNER ] = array_fill_keys( Azl_Caps::ROLES['azl_owner'][1], true );
	$GLOBALS['azl_wp']['user']               = TEST_OWNER;
	try {
		return Azl_Commands::apply( $c, $actor );
	} finally {
		$GLOBALS['azl_wp']['user'] = 0;
	}
}

/** Runs one command with a fresh opId (unless given) as $actor. */
function cmd( array $c, ?string $actor = MARIA ): array {
	$c += array( 'opId' => id() );
	return apply_as_account( $c, $actor );
}

/** Logs a request. Bundles here have two parts. @return array{0: string, 1: string[], 2: array} */
function logged( string $room, array $presets, array $extra = array() ): array {
	$request = id();
	$n       = count( $presets ) + ( isset( $extra['bundle'] ) ? 2 : 0 );
	$items   = array();
	for ( $i = 0; $i < $n; $i++ ) {
		$items[] = id();
	}
	$res = cmd( array( 'type' => 'logRequest', 'requestId' => $request, 'itemIds' => $items, 'room' => $room, 'presets' => $presets ) + $extra );
	return array( $request, $items, $res );
}

function item_row( string $id ): ?array {
	return Azl_Db::row( 'SELECT * FROM ' . Azl_Db::t( 'items' ) . ' WHERE id = %s', array( $id ) );
}

/** @return string[] */
function labels( string $entity_id ): array {
	return array_column( Azl_Db::rows( 'SELECT what FROM ' . Azl_Db::t( 'events' ) . ' WHERE entity_id = %s ORDER BY created_at, id', array( $entity_id ) ), 'what' );
}

/** Everything a replay could change: every row of every table, and the counters. */
function fingerprint(): array {
	$out = array();
	foreach ( Azl_Schema::TABLES as $t ) {
		$out[ $t ] = md5( json_encode( Azl_Db::rows( 'SELECT * FROM ' . Azl_Db::t( $t ) . ' ORDER BY 1' ) ) );
	}
	return $out;
}

/** Applies a command, then the same command again, and checks the second time changed nothing. */
function twice( array $c, ?string $actor = MARIA ): array {
	$c    += array( 'opId' => id() );
	$first = apply_as_account( $c, $actor );
	has( array( 'ok' => true, 'applied' => true ), $first, 'first ' . $c['type'] );
	$before = fingerprint();
	azl_advance( 1000 );
	$again = apply_as_account( $c, $actor );
	has( array( 'ok' => true, 'applied' => false ), $again, 'replay ' . $c['type'] );
	eq( $before, fingerprint(), 'rows after replaying ' . $c['type'] );
	return array( $first, $again );
}

function on_site_ac( string $room ): string {
	list( , $items ) = logged( $room, array( 'ac' ) );
	cmd( array( 'type' => 'onSite', 'itemId' => $items[0] ) );
	return $items[0];
}

function clean_task( string $room, string $status ): string {
	$id = id();
	Azl_Db::insert( 'clean_tasks', array( 'id' => $id, 'room' => $room, 'type' => 'Checkout', 'status' => $status, 'created_at' => Azl_Db::now(), 'updated_at' => Azl_Db::now() ) );
	return $id;
}

/* ---------- run ---------- */

foreach ( glob( __DIR__ . '/cases/*.php' ) as $azl_case ) {
	require $azl_case;
}

$azl_filter = $argv[1] ?? '';
$azl_pass   = 0;
$azl_fail   = 0;
foreach ( $GLOBALS['azl_tests'] as list( $azl_name, $azl_fn ) ) {
	if ( '' !== $azl_filter && false === stripos( $azl_name, $azl_filter ) ) {
		continue;
	}
	azl_reset();
	seed_staff();
	try {
		$azl_fn();
		$azl_pass++;
		echo "  ok    $azl_name\n";
	} catch ( Throwable $azl_e ) {
		$azl_fail++;
		echo "  FAIL  $azl_name\n        " . get_class( $azl_e ) . ': ' . $azl_e->getMessage() . "\n        at " . basename( $azl_e->getFile() ) . ':' . $azl_e->getLine() . "\n";
	}
}
echo "\n$azl_pass passed, $azl_fail failed\n";
exit( $azl_fail > 0 ? 1 : 0 );
