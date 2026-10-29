<?php
/**
 * Database helpers over $wpdb.
 *
 * Every query goes through here so that:
 * - a failed query throws (wpdb only returns false), which rolls the transaction back;
 * - the few MySQL-only pieces (FOR UPDATE, INSERT IGNORE, START TRANSACTION) live in one place
 *   that the SQLite test shim switches with Azl_Db::$dialect;
 * - the clock is one source (epoch milliseconds from PHP) that tests can fix.
 *
 * All domain times are BIGINT epoch milliseconds, like the client's numbers. MySQL's time zone
 * is never involved.
 *
 * @package azl-ehd
 */

defined( 'ABSPATH' ) || exit;

final class Azl_Db {

	/** 'mysql' in WordPress. The test suite sets 'sqlite'. */
	public static $dialect = 'mysql';

	/** A fixed time in ms for tests; null uses the real clock. */
	public static $clock = null;

	public static function now(): int {
		return null !== self::$clock ? (int) self::$clock : (int) floor( microtime( true ) * 1000 );
	}

	/** Full table name, for example wp_azl_items. */
	public static function t( string $name ): string {
		global $wpdb;
		return $wpdb->prefix . 'azl_' . $name;
	}

	/**
	 * Prepares SQL with %s / %d / %f placeholders. Null is refused: wpdb::prepare() would turn it
	 * into '' silently. Write nullable values with insert()/update() or literal().
	 */
	public static function sql( string $sql, array $args = array() ): string {
		global $wpdb;
		if ( array() === $args ) {
			return $sql;
		}
		foreach ( $args as $a ) {
			if ( null === $a || is_array( $a ) || is_object( $a ) ) {
				throw new InvalidArgumentException( 'Only scalar values can be bound' );
			}
		}
		return $wpdb->prepare( $sql, ...$args );
	}

	/** @return array<int, array<string, string|null>> */
	public static function rows( string $sql, array $args = array() ): array {
		global $wpdb;
		$rows = $wpdb->get_results( self::sql( $sql, $args ), ARRAY_A );
		self::check();
		return is_array( $rows ) ? $rows : array();
	}

	/** @return array<string, string|null>|null */
	public static function row( string $sql, array $args = array() ): ?array {
		global $wpdb;
		$row = $wpdb->get_row( self::sql( $sql, $args ), ARRAY_A );
		self::check();
		return is_array( $row ) ? $row : null;
	}

	public static function val( string $sql, array $args = array() ): ?string {
		global $wpdb;
		$v = $wpdb->get_var( self::sql( $sql, $args ) );
		self::check();
		return null === $v ? null : (string) $v;
	}

	/** wpdb reports a failed read only through last_error, which every query resets first. */
	private static function check(): void {
		global $wpdb;
		if ( '' !== (string) $wpdb->last_error ) {
			throw new RuntimeException( 'Query failed: ' . $wpdb->last_error );
		}
	}

	/** Runs a write and returns the affected row count. */
	public static function exec( string $sql, array $args = array() ): int {
		global $wpdb;
		$n = $wpdb->query( self::sql( $sql, $args ) );
		if ( false === $n ) {
			throw new RuntimeException( 'Query failed: ' . $wpdb->last_error );
		}
		return (int) $n;
	}

	public static function insert( string $table, array $data ): void {
		global $wpdb;
		if ( false === $wpdb->insert( self::t( $table ), $data ) ) {
			throw new RuntimeException( 'Insert failed: ' . $wpdb->last_error );
		}
	}

	public static function update( string $table, array $data, array $where ): int {
		global $wpdb;
		$n = $wpdb->update( self::t( $table ), $data, $where );
		if ( false === $n ) {
			throw new RuntimeException( 'Update failed: ' . $wpdb->last_error );
		}
		return (int) $n;
	}

	public static function delete( string $table, array $where ): int {
		global $wpdb;
		$n = $wpdb->delete( self::t( $table ), $where );
		if ( false === $n ) {
			throw new RuntimeException( 'Delete failed: ' . $wpdb->last_error );
		}
		return (int) $n;
	}

	/** A quoted SQL literal, or NULL. */
	public static function literal( ?string $v ): string {
		global $wpdb;
		return null === $v ? 'NULL' : $wpdb->prepare( '%s', $v );
	}

	/** "%s,%s,%s" for an IN (...) list. The caller makes sure the list is not empty. */
	public static function in( array $values ): string {
		return implode( ',', array_fill( 0, count( $values ), '%s' ) );
	}

	/* ---------- the MySQL-only pieces ---------- */

	/** Row lock for a read inside a transaction (InnoDB). SQLite locks the whole database instead. */
	public static function lock(): string {
		return 'mysql' === self::$dialect ? ' FOR UPDATE' : '';
	}

	/** Insert that skips a row which would break a unique key; affected rows is 0 then. */
	public static function insert_ignore(): string {
		return 'mysql' === self::$dialect ? 'INSERT IGNORE' : 'INSERT OR IGNORE';
	}

	/**
	 * Runs $fn in one transaction. $fn returns [bool $commit, mixed $result]. Commits or rolls back
	 * as told, and always rolls back on an exception (which is rethrown).
	 */
	public static function transaction( callable $fn ) {
		self::raw( 'mysql' === self::$dialect ? 'START TRANSACTION' : 'BEGIN' );
		try {
			list( $commit, $result ) = $fn();
		} catch ( Throwable $e ) {
			self::raw( 'ROLLBACK' );
			throw $e;
		}
		self::raw( $commit ? 'COMMIT' : 'ROLLBACK' );
		return $result;
	}

	private static function raw( string $sql ): void {
		global $wpdb;
		if ( false === $wpdb->query( $sql ) ) {
			throw new RuntimeException( $sql . ' failed: ' . $wpdb->last_error );
		}
	}

	/* ---------- counters ---------- */

	/**
	 * Adds one to a counter in azl_seq and returns the new value. Must run inside a transaction:
	 * the row stays locked until commit, and a rollback undoes the bump, so ticket numbers have no gaps.
	 */
	public static function bump( string $name ): int {
		$t = self::t( 'seq' );
		$v = self::val( "SELECT val FROM $t WHERE name = %s" . self::lock(), array( $name ) );
		if ( null === $v ) {
			self::exec( self::insert_ignore() . " INTO $t (name, val) VALUES (%s, 0)", array( $name ) );
			$v = self::val( "SELECT val FROM $t WHERE name = %s" . self::lock(), array( $name ) );
		}
		$n = (int) $v + 1;
		self::exec( "UPDATE $t SET val = %d WHERE name = %s", array( $n, $name ) );
		return $n;
	}

	/** The current value of a counter, without a lock. */
	public static function counter( string $name ): int {
		return (int) self::val( 'SELECT val FROM ' . self::t( 'seq' ) . ' WHERE name = %s', array( $name ) );
	}

	/** A random version 4 uuid, lower case. */
	public static function uuid(): string {
		$b    = random_bytes( 16 );
		$b[6] = chr( ( ord( $b[6] ) & 0x0f ) | 0x40 );
		$b[8] = chr( ( ord( $b[8] ) & 0x3f ) | 0x80 );
		return vsprintf( '%s%s-%s-%s-%s-%s%s%s', str_split( bin2hex( $b ), 4 ) );
	}

	public static function is_uuid( $v ): bool {
		return is_string( $v ) && 1 === preg_match( '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/i', $v );
	}
}
