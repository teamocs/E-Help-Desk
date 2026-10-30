<?php
/**
 * The module framework. A desk module (Inquiries, House Status, ...) is one file in includes/Modules/ that
 * defines a subclass of Azl_Module and registers it:
 *
 *   final class Azl_Module_Inquiries extends Azl_Module {
 *       public function id(): string { return 'inquiries'; }
 *       public function schema() { return 'CREATE TABLE ' . Azl_Db::t( 'inquiries' ) . ' ( ... ) ' . Azl_Schema::table_options() . ';'; }
 *       public function sequences(): array { return array( 'inq' ); }
 *       public function commands(): array { return array( 'logInquiry' => array( 'run' => array( $this, 'log' ), 'ids' => array( 'inquiryId' ) ) ); }
 *       public function snapshot( array $who ): array { return array( 'list' => ... ); }
 *   }
 *   Azl_Modules::register( new Azl_Module_Inquiries() );
 *
 * The plugin loads includes/Modules/*.php after includes/*.php. Nothing else needs editing:
 * - Azl_Schema creates the module's tables (additive: CREATE TABLE only) and its azl_seq counters, and upgrades
 *   when the module's version() changes;
 * - Azl_Commands runs the module's commands with the same op-id idempotency, transaction and event claim as the
 *   built-in ones, after Azl_Access has checked the actor's level on the module;
 * - Azl_Snapshot sends snapshot() as snapshot.modules.<id>, only to actors who may read the module;
 * - Azl_Catalog adds the module's editable lists (catalogLists()) to the hotel's lists.
 *
 * @package azl-ehd
 */

defined( 'ABSPATH' ) || exit;

abstract class Azl_Module {

	/** The module id: a sidebar id from Azl_Access::LABELS, or a new one ([a-z][a-z0-9_]{1,19}). */
	abstract public function id(): string;

	/** Bump when schema(), sequences() or catalogLists() change, so every site upgrades once. */
	public function version(): string {
		return '1';
	}

	/**
	 * dbDelta SQL: one CREATE TABLE statement, or a list of them, for tables named Azl_Db::t( '...' ). Additive only:
	 * new tables or new columns; never DROP, ALTER or data changes (dbDelta never drops anything either).
	 *
	 * @return string|string[]
	 */
	public function schema() {
		return array();
	}

	/** Names of azl_seq counters this module bumps for its numbers (for example 'inq' for I-0001). */
	public function sequences(): array {
		return array();
	}

	/**
	 * Command type => definition:
	 * - run (required): callable( array $cmd, Azl_Commands $ctx ): array. Validate, then claim with
	 *   $ctx->claim( entity, id, what ); when the claim fails return $ctx->replay( $cmd ). Then write and
	 *   return Azl_Commands::ok( ... ) or Azl_Commands::fail( 'reason' ).
	 * - validate: callable( array $cmd ): ?string, a plain-language problem or null. Runs before run().
	 * - ids: id fields the command must carry (each *Id field is checked to be a uuid anyway).
	 * - need: 'own' (default: own or full access) or 'full'.
	 * - scope: callable( array $cmd, array $who ): bool, for actors with own access: true when the row is theirs.
	 * - prior: callable( string $entity_id ): array, extra result fields for a replayed op (like a number).
	 * - module: the module the command belongs to (default: this module).
	 */
	public function commands(): array {
		return array();
	}

	/** The module's data for the snapshot (snapshot.modules.<id>). Only sent to actors who may read the module. */
	public function snapshot( array $who ): array {
		return array();
	}

	/**
	 * Extra editable lists for the hotel's lists (Azl_Catalog): list key => array(
	 *   'label'    => array( 'vehicle', 'vehicles' ),  // singular and plural, for messages
	 *   'maxItems' => 20,
	 *   'fields'   => array( array( 'name' => 'plate', 'type' => 'text', 'max' => 20, 'required' => false ) ), // text, bool or int
	 *   'seed'     => array( array( 'label' => 'Van 1', 'plate' => '' ) ),
	 * ). Every entry also has key, label and active, like the built-in lists.
	 */
	public function catalogLists(): array {
		return array();
	}

	/**
	 * Access for a module id that is not in Azl_Access::MATRIX: kind => level. Ignored for the 11 sidebar modules,
	 * whose row in the matrix wins.
	 */
	public function capabilities(): array {
		return array();
	}
}

final class Azl_Modules {

	/** @var array<string, Azl_Module> */
	private static $mods = array();

	const ID = '/^[a-z][a-z0-9_]{1,19}\z/';

	/**
	 * Adds a module. Throws (the plugin loader then shows the message in wp-admin) when its id, command types,
	 * list keys or schema clash with what exists or are not additive.
	 */
	public static function register( Azl_Module $m ): void {
		$id = $m->id();
		if ( ! preg_match( self::ID, $id ) || isset( self::$mods[ $id ] ) ) {
			throw new InvalidArgumentException( "Module id $id is not valid or already registered" );
		}
		foreach ( $m->commands() as $type => $def ) {
			if ( ! is_string( $type ) || ! preg_match( '/^[a-z][A-Za-z0-9]{1,39}\z/', $type ) || isset( Azl_Commands::REQUIRED_IDS[ $type ] ) || null !== self::command( $type ) ) {
				throw new InvalidArgumentException( "Module $id: command $type is not valid or already taken" );
			}
			if ( ! is_array( $def ) || ! is_callable( $def['run'] ?? null ) ) {
				throw new InvalidArgumentException( "Module $id: command $type needs a run callable" );
			}
		}
		foreach ( array_keys( $m->catalogLists() ) as $key ) {
			if ( ! is_string( $key ) || ! preg_match( '/^[a-z][A-Za-z0-9]{1,39}\z/', $key ) || in_array( $key, Azl_Catalog::LISTS, true ) || isset( self::lists()[ $key ] ) ) {
				throw new InvalidArgumentException( "Module $id: list $key is not valid or already taken" );
			}
		}
		foreach ( $m->sequences() as $seq ) {
			if ( ! is_string( $seq ) || ! preg_match( '/^[a-z][a-z0-9_]{1,19}\z/', $seq ) ) {
				throw new InvalidArgumentException( "Module $id: sequence name $seq is not valid" );
			}
		}
		foreach ( self::statements( $m ) as $sql ) {
			$problem = self::schema_problem( $sql );
			if ( null !== $problem ) {
				throw new InvalidArgumentException( "Module $id: $problem" );
			}
		}
		self::$mods[ $id ] = $m;
	}

	/** Removes a module from this request's registry (tests). Its tables and data stay. */
	public static function forget( string $id ): void {
		unset( self::$mods[ $id ] );
	}

	/** @return array<string, Azl_Module> */
	public static function all(): array {
		return self::$mods;
	}

	public static function get( string $id ): ?Azl_Module {
		return self::$mods[ $id ] ?? null;
	}

	/** A module command's definition with 'module' filled in, or null. */
	public static function command( string $type ): ?array {
		foreach ( self::$mods as $id => $m ) {
			$defs = $m->commands();
			if ( isset( $defs[ $type ] ) ) {
				return $defs[ $type ] + array( 'module' => $id, 'need' => 'own' );
			}
		}
		return null;
	}

	/** @return string[] */
	private static function statements( Azl_Module $m ): array {
		$s = $m->schema();
		return array_values( array_filter( is_array( $s ) ? $s : array( $s ), 'is_string' ) );
	}

	/** Why a module statement is not allowed, or null. Only CREATE TABLE of a new azl_ table. */
	public static function schema_problem( string $sql ): ?string {
		global $wpdb;
		$p = preg_quote( $wpdb->prefix . 'azl_', '/' );
		if ( ! preg_match( '/^\s*CREATE TABLE\s+' . $p . '([a-z0-9_]+)\s*\(/i', $sql, $m ) ) {
			return 'schema must be CREATE TABLE ' . $wpdb->prefix . 'azl_<name> statements';
		}
		if ( preg_match( '/\b(DROP|ALTER|TRUNCATE|DELETE|UPDATE|INSERT|RENAME|GRANT)\b/i', $sql ) || substr_count( $sql, ';' ) > 1 ) {
			return 'schema may only create tables (additive changes only)';
		}
		if ( in_array( strtolower( $m[1] ), Azl_Schema::TABLES, true ) && ! self::extends_core( strtolower( $m[1] ), $sql ) ) {
			return "table azl_{$m[1]} belongs to the plugin";
		}
		return null;
	}

	/**
	 * A module may redeclare a plugin table only to ADD columns or keys (dbDelta keeps the last statement per table and
	 * adds what is missing): every line of the plugin's own statement must appear unchanged, so no column type changes,
	 * and no other registered module may extend the same table (one of the two would lose its columns).
	 */
	private static function extends_core( string $table, string $sql ): bool {
		global $wpdb;
		$lines = static function ( string $s ): array {
			return array_map(
				static function ( $l ) {
					return rtrim( trim( $l ), ',' );
				},
				explode( "\n", preg_replace( '/^[^(]*\(|\)[^)]*$/s', '', trim( $s ) ) )
			);
		};
		$core = null;
		foreach ( Azl_Schema::sql() as $s ) {
			if ( preg_match( '/^\s*CREATE TABLE\s+' . preg_quote( $wpdb->prefix . 'azl_' . $table, '/' ) . '\s*\(/i', $s ) ) {
				$core = $core ?? $s; // the plugin's statement comes first; later ones are modules'
				if ( $s !== $core ) {
					return false;
				}
			}
		}
		return null !== $core && array() === array_diff( array_filter( $lines( $core ) ), $lines( $sql ) );
	}

	/** Every module's CREATE TABLE statements. */
	public static function schema(): array {
		$out = array();
		foreach ( self::$mods as $m ) {
			$out = array_merge( $out, self::statements( $m ) );
		}
		return $out;
	}

	/** Every module's azl_seq counter names. */
	public static function sequences(): array {
		$out = array();
		foreach ( self::$mods as $m ) {
			$out = array_merge( $out, $m->sequences() );
		}
		return array_values( array_unique( $out ) );
	}

	/** Part of the database version: changes when a module is added or bumps its version(). '' with no modules. */
	public static function signature(): string {
		$parts = array();
		foreach ( self::$mods as $id => $m ) {
			$parts[] = $id . '@' . $m->version();
		}
		sort( $parts );
		return implode( ',', $parts );
	}

	/** Slices for snapshot.modules: only the modules this actor may read. */
	public static function snapshot( array $who ): array {
		$out = array();
		foreach ( self::$mods as $id => $m ) {
			if ( 'none' !== Azl_Access::level( $id, $who ) ) {
				$out[ $id ] = $m->snapshot( $who );
			}
		}
		return $out;
	}

	/** Every module's list definitions: list key => definition (see Azl_Module::catalogLists()). */
	public static function lists(): array {
		$out = array();
		foreach ( self::$mods as $m ) {
			$out += $m->catalogLists();
		}
		return $out;
	}
}
