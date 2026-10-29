<?php
/**
 * A small $wpdb stand-in over PDO SQLite (in memory), for tests only.
 *
 * Faithful to wpdb where the plugin depends on it:
 * - prepare() quotes %s, casts %d and %f, and turns null into '' (as wpdb does, which is why
 *   Azl_Db refuses to bind null);
 * - every value read back is a string or null, like mysqli results;
 * - query() returns affected rows for writes (0 for an ignored duplicate) and false on error,
 *   with the message in last_error; get_* reset last_error first.
 * - insert()/update()/delete() write PHP null as SQL NULL.
 *
 * What it cannot prove (check on real MySQL): row locks (SELECT ... FOR UPDATE is switched off,
 * SQLite locks the whole file), INSERT IGNORE (SQLite runs INSERT OR IGNORE), MySQL's
 * affected-rows counting changed rows only, dbDelta's parsing of the CREATE TABLE text, index
 * key-length limits, utf8mb4 collation, strict-mode truncation, and REPEATABLE READ visibility.
 */
final class Wpdb_Sqlite {

	public $prefix     = 'wp_';
	public $last_error = '';
	public $insert_id  = 0;
	public $num_rows   = 0;
	/** @var PDO */
	public $pdo;
	/** Every SQL string run, for tests that look at what was sent. */
	public $log = array();

	public function __construct() {
		$this->pdo = new PDO( 'sqlite::memory:' );
		$this->pdo->setAttribute( PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION );
	}

	public function get_charset_collate(): string {
		return 'DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci';
	}

	public function prepare( $query, ...$args ) {
		if ( 1 === count( $args ) && is_array( $args[0] ) ) {
			$args = $args[0];
		}
		$i   = 0;
		$out = preg_replace_callback(
			'/%%|%[sdf]/',
			function ( $m ) use ( &$i, $args ) {
				if ( '%%' === $m[0] ) {
					return '%';
				}
				if ( ! array_key_exists( $i, $args ) ) {
					throw new LogicException( 'prepare(): fewer arguments than placeholders' );
				}
				$v = $args[ $i++ ];
				if ( '%d' === $m[0] ) {
					return (string) (int) $v;
				}
				if ( '%f' === $m[0] ) {
					return sprintf( '%F', (float) $v );
				}
				return $this->pdo->quote( null === $v ? '' : (string) $v );
			},
			$query
		);
		if ( $i !== count( $args ) ) {
			throw new LogicException( 'prepare(): more arguments than placeholders' );
		}
		return $out;
	}

	/** @return int|false */
	public function query( $sql ) {
		$this->last_error = '';
		$this->log[]      = $sql;
		try {
			if ( preg_match( '/^\s*(SELECT|WITH|PRAGMA)\b/i', $sql ) ) {
				$st             = $this->pdo->query( $sql );
				$this->last_rows = $st->fetchAll( PDO::FETCH_ASSOC );
				$this->num_rows = count( $this->last_rows );
				return $this->num_rows;
			}
			$n = $this->pdo->exec( $sql );
			if ( preg_match( '/^\s*INSERT\b/i', $sql ) ) {
				$this->insert_id = (int) $this->pdo->lastInsertId();
			}
			return (int) $n;
		} catch ( PDOException $e ) {
			$this->last_error = $e->getMessage();
			return false;
		}
	}

	/** @var array */
	private $last_rows = array();

	private function select( $sql ): array {
		$this->last_rows = array();
		if ( false === $this->query( $sql ) ) {
			return array();
		}
		return array_map(
			static function ( $r ) {
				return array_map(
					static function ( $v ) {
						return null === $v ? null : (string) $v;
					},
					$r
				);
			},
			$this->last_rows
		);
	}

	public function get_results( $sql, $output = 'OBJECT' ) {
		return $this->select( $sql );
	}

	public function get_row( $sql, $output = 'OBJECT' ) {
		$rows = $this->select( $sql );
		return $rows[0] ?? null;
	}

	public function get_var( $sql ) {
		$rows = $this->select( $sql );
		if ( ! $rows ) {
			return null;
		}
		$first = reset( $rows[0] );
		return false === $first ? null : $first;
	}

	public function get_col( $sql ) {
		return array_map( 'reset', $this->select( $sql ) );
	}

	private function value( $v ): string {
		return null === $v ? 'NULL' : $this->pdo->quote( is_bool( $v ) ? ( $v ? '1' : '0' ) : (string) $v );
	}

	private function where( array $where ): string {
		$w = array();
		foreach ( $where as $k => $v ) {
			$w[] = null === $v ? "$k IS NULL" : "$k = " . $this->value( $v );
		}
		return implode( ' AND ', $w );
	}

	public function insert( $table, $data, $format = null ) {
		$cols = implode( ', ', array_keys( $data ) );
		$vals = implode( ', ', array_map( array( $this, 'value' ), array_values( $data ) ) );
		return $this->query( "INSERT INTO $table ($cols) VALUES ($vals)" );
	}

	public function update( $table, $data, $where, $format = null, $where_format = null ) {
		$set = array();
		foreach ( $data as $k => $v ) {
			$set[] = "$k = " . $this->value( $v );
		}
		return $this->query( "UPDATE $table SET " . implode( ', ', $set ) . ' WHERE ' . $this->where( $where ) );
	}

	public function delete( $table, $where, $where_format = null ) {
		return $this->query( "DELETE FROM $table WHERE " . $this->where( $where ) );
	}
}

/**
 * Turns one dbDelta CREATE TABLE (as Azl_Schema::sql() writes it) into SQLite statements, so the
 * tests run on the real column list. MySQL types are kept (SQLite maps them by affinity).
 *
 * @return string[]
 */
function azl_sqlite_ddl( string $create ): array {
	if ( ! preg_match( '/^CREATE TABLE (\w+) \((.*)\n\)[^)]*$/s', trim( $create ), $m ) ) {
		throw new LogicException( "Unexpected CREATE TABLE layout:\n$create" );
	}
	list( , $table, $body ) = $m;
	$cols    = array();
	$indexes = array();
	$autoinc = false;
	foreach ( explode( "\n", trim( $body ) ) as $line ) {
		$l = rtrim( trim( $line ), ',' );
		if ( preg_match( '/^PRIMARY KEY  \((.+)\)$/', $l, $k ) ) {
			if ( ! $autoinc ) {
				$cols[] = "PRIMARY KEY ($k[1])";
			}
		} elseif ( preg_match( '/^UNIQUE KEY (\w+) \((.+)\)$/', $l, $k ) ) {
			$cols[] = "UNIQUE ($k[2])";
		} elseif ( preg_match( '/^KEY (\w+) \((.+)\)$/', $l, $k ) ) {
			$indexes[] = "CREATE INDEX IF NOT EXISTS {$table}_$k[1] ON $table ($k[2])";
		} elseif ( false !== strpos( $l, 'AUTO_INCREMENT' ) ) {
			$autoinc = true;
			$cols[]  = strtok( $l, ' ' ) . ' INTEGER PRIMARY KEY AUTOINCREMENT';
		} elseif ( preg_match( '/^(PRIMARY|UNIQUE|KEY|INDEX)\b/', $l ) ) {
			throw new LogicException( "Line breaks the dbDelta layout: $l" );
		} else {
			$cols[] = str_replace( ' unsigned', '', $l );
		}
	}
	return array_merge( array( "CREATE TABLE IF NOT EXISTS $table (\n  " . implode( ",\n  ", $cols ) . "\n)" ), $indexes );
}
