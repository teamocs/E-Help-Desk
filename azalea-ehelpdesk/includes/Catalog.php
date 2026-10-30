<?php
/**
 * Each hotel's own lists: departments, request types, bundles, hold reasons, job titles and work-order
 * findings. One option, azl_catalog (JSON, not autoloaded), seeded on first read from Azl_Rules.
 *
 * Shape (the same in src/domain/catalog.ts):
 *   { catalogRev: int,
 *     departments:  [{key, label, short, repairs, active}]  (repairs: its items can become work orders),
 *     requestTypes: [{key, label, dept, slaMin, icon, active}],
 *     bundles:      [{key, label, hint, parts: [{name, dept, slaMin, after?}], active}],
 *     holdReasons | jobTitles | woFindings: [{key, label, active}] }
 * Modules add lists of their own (Azl_Module::catalogLists(): key, label, maxItems, fields, seed): entries
 * {key, label, active, ...declared fields}, checked by module_entry(), seeded when the module first appears.
 * Order is array order. Keys are [a-z0-9_]{2,20} (the varchar(20) columns), made from the label on
 * create and never changed. Records store keys (items, staff and work orders a department key, held
 * items a hold-reason key) or copies (an item copies a request type's name, department and SLA).
 *
 * Integrity, enforced by save():
 * - a key is removed only when nothing uses it: no staff row, item or work order (departments), no held
 *   item (hold reasons), no request type or bundle part (departments). Otherwise 409 azl_in_use with
 *   counts: archive it instead (active=false hides it from new choices; records keep their key and label);
 * - at least one active department and one active hold reason, and, while any work order is open, one
 *   active department that handles repairs (repairs=true: its items can be escalated to a work order);
 * - an active request type or bundle uses active departments; an archived one, existing departments;
 *   so a department cannot be archived while an active request type or bundle uses it.
 *
 * Concurrency: save() and every command or staff change that checks a key against the catalog first
 * lock the azl_seq row "catalog" (locked()), so a key cannot be removed while a write is using it.
 * save() also compares the client's baseRev with catalogRev: 409 azl_stale when someone saved since.
 *
 * @package azl-ehd
 */

defined( 'ABSPATH' ) || exit;

final class Azl_Catalog {

	const OPTION = 'azl_catalog';
	const LOCK   = 'catalog';
	const LISTS  = array( 'departments', 'requestTypes', 'bundles', 'holdReasons', 'jobTitles', 'woFindings' );
	const MAX    = array(
		'departments'  => 40,
		'requestTypes' => 80,
		'bundles'      => 20,
		'holdReasons'  => 20,
		'jobTitles'    => 60,
		'woFindings'   => 20,
	);
	/** Singular and plural, for messages. */
	const NOUN = array(
		'departments'  => array( 'department', 'departments' ),
		'requestTypes' => array( 'request type', 'request types' ),
		'bundles'      => array( 'bundle', 'bundles' ),
		'holdReasons'  => array( 'hold reason', 'hold reasons' ),
		'jobTitles'    => array( 'job title', 'job titles' ),
		'woFindings'   => array( 'finding', 'findings' ),
	);
	const LABEL_MAX = 40;
	const SHORT_MAX = 6;
	const HINT_MAX  = 120;
	const SLA_MAX   = 1440;
	const MAX_PARTS = 6;
	const KEY_MAX   = 20;

	/** The icons a request type may use: the names src/ui/icons.ts can draw (REQUEST_ICONS in catalog.ts). */
	const ICONS = array(
		'towel', 'bed', 'drop', 'broom', 'check', 'snow', 'bulb', 'flame', 'wifi', 'tv', 'bottle', 'tray', 'clock', 'ear',
		'wrench', 'bell', 'home', 'bolt', 'sun', 'star', 'user', 'info', 'device', 'waves', 'printer', 'hand', 'clip',
		'spa', 'shirt', 'key', 'car', 'suitcase', 'food', 'coffee', 'firstaid', 'phone', 'trash', 'plug', 'bug', 'pool', 'baby',
	);

	const STALE = 'Someone else changed this list. Your screen was refreshed; try again.';

	/* ---------- the lists: the built-in ones, then each module's (Azl_Module::catalogLists()) ---------- */

	/** Every list key, built-in first. */
	public static function lists(): array {
		return array_merge( self::LISTS, array_keys( self::module_lists() ) );
	}

	/** Module list definitions: key => {label: [singular, plural], maxItems, fields, seed}. */
	private static function module_lists(): array {
		return class_exists( 'Azl_Modules' ) ? Azl_Modules::lists() : array();
	}

	private static function max_of( string $list ): int {
		return self::MAX[ $list ] ?? max( 1, min( 200, (int) ( self::module_lists()[ $list ]['maxItems'] ?? 20 ) ) );
	}

	private static function noun( string $list, int $i ): string {
		$n = self::NOUN[ $list ] ?? (array) ( self::module_lists()[ $list ]['label'] ?? array( 'entry', 'entries' ) );
		return (string) ( $n[ $i ] ?? $n[0] );
	}

	/** A module list's seed entries, with keys made from their labels. */
	private static function module_seed( array $def ): array {
		$out   = array();
		$taken = array();
		foreach ( (array) ( $def['seed'] ?? array() ) as $row ) {
			$clean = self::module_entry( $def, is_array( $row ) ? $row : array() );
			$label = self::text( $row['label'] ?? null );
			if ( is_string( $clean ) || '' === $label ) {
				continue; // a bad seed row is skipped, never stored
			}
			$key           = self::make_key( $label, $taken );
			$taken[ $key ] = true;
			$out[]         = array( 'key' => $key, 'label' => $label ) + $clean + array( 'active' => true );
		}
		return $out;
	}

	/**
	 * A module list entry's declared fields, checked and normalised: text (max, required), bool or int (min, max).
	 *
	 * @return array|string the fields, or the problem in plain language
	 */
	private static function module_entry( array $def, array $in ) {
		$out = array();
		foreach ( (array) ( $def['fields'] ?? array() ) as $f ) {
			$name = (string) ( $f['name'] ?? '' );
			if ( '' === $name || in_array( $name, array( 'key', 'label', 'active' ), true ) ) {
				continue;
			}
			$what = (string) ( $f['label'] ?? $name );
			$type = $f['type'] ?? 'text';
			$v    = $in[ $name ] ?? ( $f['default'] ?? null );
			if ( 'bool' === $type ) {
				if ( ! is_bool( $v ?? false ) ) {
					return "Choose yes or no for $what.";
				}
				$out[ $name ] = (bool) $v;
			} elseif ( 'int' === $type ) {
				if ( is_float( $v ) && floor( $v ) === $v ) {
					$v = (int) $v;
				}
				$min = (int) ( $f['min'] ?? 0 );
				$max = (int) ( $f['max'] ?? PHP_INT_MAX );
				if ( ! is_int( $v ) || $v < $min || $v > $max ) {
					return "Enter a whole number for $what from $min to $max.";
				}
				$out[ $name ] = $v;
			} else {
				$v   = self::text( $v ?? '' );
				$max = (int) ( $f['max'] ?? self::LABEL_MAX );
				if ( ! empty( $f['required'] ) && '' === $v ) {
					return "Enter the $what.";
				}
				if ( mb_strlen( $v ) > $max ) {
					return "Keep the $what under $max characters.";
				}
				$out[ $name ] = $v;
			}
		}
		return $out;
	}

	/* ---------- reading ---------- */

	/** The factory lists, from Azl_Rules. catalogRev 0. */
	public static function seed(): array {
		$choices = static function ( array $map ): array {
			$out = array();
			foreach ( $map as $key => $label ) {
				$out[] = array( 'key' => $key, 'label' => $label, 'active' => true );
			}
			return $out;
		};
		$cat = array( 'catalogRev' => 0 );
		foreach ( Azl_Rules::DEPTS as $key => $d ) {
			$cat['departments'][] = array( 'key' => $key, 'label' => $d['label'], 'short' => $d['short'], 'repairs' => $d['repairs'], 'active' => true );
		}
		foreach ( Azl_Rules::PRESETS as $key => $p ) {
			$cat['requestTypes'][] = array( 'key' => $key, 'label' => $p[0], 'dept' => $p[1], 'slaMin' => $p[2], 'icon' => $p[3], 'active' => true );
		}
		foreach ( Azl_Rules::BUNDLES as $key => $b ) {
			$cat['bundles'][] = array( 'key' => $key, 'label' => $b['label'], 'hint' => $b['hint'], 'parts' => $b['parts'], 'active' => true );
		}
		$cat['holdReasons'] = $choices( Azl_Rules::HOLD_REASONS );
		$cat['jobTitles']   = $choices( Azl_Rules::JOB_TITLES );
		$cat['woFindings']  = $choices( Azl_Rules::WO_FINDINGS );
		foreach ( self::module_lists() as $key => $def ) {
			$cat[ $key ] = self::module_seed( $def );
		}
		return $cat;
	}

	/** The stored catalog, or null when the option is missing or not a catalog. */
	private static function decode( $raw ): ?array {
		$cat = is_string( $raw ) ? json_decode( $raw, true ) : null;
		if ( ! is_array( $cat ) || ! is_int( $cat['catalogRev'] ?? null ) ) {
			return null;
		}
		foreach ( self::LISTS as $list ) {
			if ( ! is_array( $cat[ $list ] ?? null ) || ! array_is_list( $cat[ $list ] ) ) {
				return null;
			}
		}
		foreach ( $cat['departments'] as $i => $d ) {
			if ( ! is_bool( $d['repairs'] ?? null ) ) { // stored before the flag existed: the factory value
				$cat['departments'][ $i ]['repairs'] = (bool) ( Azl_Rules::DEPTS[ $d['key'] ?? '' ]['repairs'] ?? false );
			}
		}
		// A module added since the lists were stored starts from its seed; it is stored with the next save.
		foreach ( self::module_lists() as $key => $def ) {
			if ( ! is_array( $cat[ $key ] ?? null ) || ! array_is_list( $cat[ $key ] ) ) {
				$cat[ $key ] = self::module_seed( $def );
			}
		}
		return $cat;
	}

	/** The catalog, seeded and stored on first read. Unlocked: for snapshots and reads. */
	public static function get(): array {
		$raw = get_option( self::OPTION, null );
		$cat = self::decode( $raw );
		if ( null !== $cat ) {
			return $cat;
		}
		if ( null !== $raw ) {
			error_log( 'azl-ehd: the stored lists could not be read; using the factory lists until they are saved again.' );
		}
		$cat = self::seed();
		if ( null === $raw ) {
			add_option( self::OPTION, wp_json_encode( $cat ), '', false );
		}
		return $cat;
	}

	/**
	 * Locks the catalog row for the rest of the transaction, then reads the catalog fresh from the
	 * database. Call inside Azl_Db::transaction() before any other row lock (lock order: catalog first).
	 */
	public static function locked(): array {
		$t = Azl_Db::t( 'seq' );
		if ( null === Azl_Db::val( "SELECT val FROM $t WHERE name = %s" . Azl_Db::lock(), array( self::LOCK ) ) ) {
			Azl_Db::exec( Azl_Db::insert_ignore() . " INTO $t (name, val) VALUES (%s, 0)", array( self::LOCK ) );
			Azl_Db::val( "SELECT val FROM $t WHERE name = %s" . Azl_Db::lock(), array( self::LOCK ) );
		}
		if ( function_exists( 'wp_cache_delete' ) ) {
			wp_cache_delete( self::OPTION, 'options' ); // another request may have saved since this one started
		}
		return self::get();
	}

	/** The entry with this key, archived or not, or null. */
	public static function find( array $cat, string $list, $key ): ?array {
		foreach ( is_string( $key ) ? $cat[ $list ] : array() as $x ) {
			if ( $x['key'] === $key ) {
				return $x;
			}
		}
		return null;
	}

	/** The entry with this key when it is active (offered for new work), or null. */
	public static function active( array $cat, string $list, $key ): ?array {
		$x = self::find( $cat, $list, $key );
		return null !== $x && true === $x['active'] ? $x : null;
	}

	/**
	 * How many records use each key: {departments: {key: {people, requests, workOrders}}, holdReasons:
	 * {key: {requests}}, openWorkOrders}. People counts every staff row (removed people keep their department);
	 * requests counts the requests with at least one item in that department or held for that reason.
	 */
	public static function usage(): array {
		$out = array( 'departments' => array(), 'holdReasons' => array() );
		$q   = array(
			array( 'departments', 'people', 'SELECT dept AS k, COUNT(*) AS n FROM ' . Azl_Db::t( 'staff' ) . ' WHERE dept IS NOT NULL GROUP BY dept' ),
			array( 'departments', 'requests', 'SELECT dept AS k, COUNT(DISTINCT request_id) AS n FROM ' . Azl_Db::t( 'items' ) . ' GROUP BY dept' ),
			array( 'departments', 'workOrders', 'SELECT dept AS k, COUNT(*) AS n FROM ' . Azl_Db::t( 'work_orders' ) . ' GROUP BY dept' ),
			array( 'holdReasons', 'requests', 'SELECT hold_reason AS k, COUNT(DISTINCT request_id) AS n FROM ' . Azl_Db::t( 'items' ) . ' WHERE hold_reason IS NOT NULL GROUP BY hold_reason' ),
		);
		foreach ( $q as list( $list, $what, $sql ) ) {
			foreach ( Azl_Db::rows( $sql ) as $r ) {
				$out[ $list ][ $r['k'] ][ $what ] = (int) $r['n'];
			}
		}
		return array(
			'departments'    => (object) $out['departments'],
			'holdReasons'    => (object) $out['holdReasons'],
			'openWorkOrders' => self::open_work_orders(),
		);
	}

	/** Work orders not done yet: while there are any, one active department must handle repairs. */
	private static function open_work_orders(): int {
		return (int) Azl_Db::val( 'SELECT COUNT(*) FROM ' . Azl_Db::t( 'work_orders' ) . " WHERE status <> 'done'" );
	}

	/* ---------- saving ---------- */

	/**
	 * Replaces one whole list. $items: the list as the editor shows it (new entries without a key);
	 * $base_rev: the catalogRev the editor loaded.
	 *
	 * @return array{0: int, 1: array} HTTP status and body: 200 {ok, catalog, usage};
	 *   400 {ok:false, code:azl_invalid, error, index?}; 409 {ok:false, code:azl_in_use, error, index?, key?};
	 *   409 {ok:false, code:azl_stale, error, catalog, usage}.
	 */
	public static function save( string $list, $items, $base_rev ): array {
		if ( ! in_array( $list, self::lists(), true ) ) {
			return array( 404, array( 'ok' => false, 'code' => 'azl_invalid', 'error' => 'Unknown list.' ) );
		}
		if ( ! is_array( $items ) || ! array_is_list( $items ) || ! is_int( $base_rev ) ) {
			return array( 400, self::invalid( 'Send the whole list and the version you loaded.' ) );
		}
		if ( count( $items ) > self::max_of( $list ) ) {
			return array( 400, self::invalid( 'Keep the list to ' . self::max_of( $list ) . ' ' . self::noun( $list, 1 ) . '.' ) );
		}
		return Azl_Db::transaction(
			static function () use ( $list, $items, $base_rev ) {
				$cur = self::locked();
				if ( $base_rev !== $cur['catalogRev'] ) {
					return array( false, array( 409, array( 'ok' => false, 'code' => 'azl_stale', 'error' => self::STALE, 'catalog' => $cur, 'usage' => self::usage() ) ) );
				}
				$clean = self::clean( $list, $items, $cur );
				if ( isset( $clean['error'] ) ) {
					return array( false, array( 400, array( 'ok' => false, 'code' => 'azl_invalid' ) + $clean ) );
				}
				$usage   = self::usage();
				$problem = self::in_use( $list, $clean, $cur, $usage );
				if ( null !== $problem ) {
					return array( false, array( 409, array( 'ok' => false, 'code' => 'azl_in_use' ) + $problem ) );
				}
				$next                = $cur;
				$next[ $list ]       = $clean;
				$next['catalogRev'] = $cur['catalogRev'] + 1;
				update_option( self::OPTION, wp_json_encode( $next ), false );
				Azl_Db::bump( 'change' ); // phones refresh on their next poll
				return array( true, array( 200, array( 'ok' => true, 'catalog' => $next, 'usage' => $usage ) ) );
			}
		);
	}

	private static function invalid( string $error, ?int $index = null ): array {
		return array( 'ok' => false, 'code' => 'azl_invalid', 'error' => $error ) + ( null === $index ? array() : array( 'index' => $index ) );
	}

	private static function err( string $error, ?int $index = null ): array {
		return array( 'error' => $error ) + ( null === $index ? array() : array( 'index' => $index ) );
	}

	/** A one-line text field: sanitised and trimmed, or '' when not a string. */
	private static function text( $v ): string {
		return is_string( $v ) ? trim( sanitize_text_field( $v ) ) : '';
	}

	private static function sla( $v ): ?int {
		if ( is_float( $v ) && floor( $v ) === $v ) {
			$v = (int) $v;
		}
		return is_int( $v ) && $v >= 1 && $v <= self::SLA_MAX ? $v : null;
	}

	/** A department key this entry may use: any existing one, and an active one when the entry is active. */
	private static function dept_problem( array $cur, $dept, bool $active ): ?string {
		$d = self::find( $cur, 'departments', $dept );
		if ( null === $d ) {
			return 'Pick a department.';
		}
		return $active && true !== $d['active'] ? 'Pick an active department, or archive this first.' : null;
	}

	/** A new stable key from the label: lower-case [a-z0-9_], 2 to 20 characters, not taken. */
	public static function make_key( string $label, array $taken ): string {
		$ascii = function_exists( 'remove_accents' ) ? remove_accents( $label ) : $label;
		$base  = trim( (string) preg_replace( '/[^a-z0-9]+/', '_', strtolower( $ascii ) ), '_' );
		$base = substr( '' === $base ? 'item' : $base, 0, self::KEY_MAX );
		$key  = $base;
		for ( $n = 2; strlen( $key ) < 2 || isset( $taken[ $key ] ); $n++ ) {
			$suffix = '_' . $n;
			$key    = rtrim( substr( $base, 0, self::KEY_MAX - strlen( $suffix ) ), '_' ) . $suffix;
		}
		return $key;
	}

	/**
	 * Checks and normalises the submitted list against the current catalog. @return array the clean
	 * list, or {error, index?}.
	 */
	private static function clean( string $list, array $items, array $cur ): array {
		$known  = array_column( $cur[ $list ], null, 'key' );
		$out    = array();
		$keys   = array();
		$labels = array();
		foreach ( $items as $i => $in ) {
			if ( ! is_array( $in ) || ( array() !== $in && array_is_list( $in ) ) ) {
				return self::err( 'This entry is not valid.', $i );
			}
			$key = $in['key'] ?? null;
			if ( null !== $key && '' !== $key ) {
				if ( ! is_string( $key ) || ! isset( $known[ $key ] ) ) {
					return self::err( 'This entry no longer exists. Reload the list.', $i );
				}
				if ( isset( $keys[ $key ] ) ) {
					return self::err( 'This entry is in the list twice.', $i );
				}
				$keys[ $key ] = true;
			} else {
				$key = null;
			}
			$label = self::text( $in['label'] ?? null );
			if ( '' === $label || mb_strlen( $label ) > self::LABEL_MAX ) {
				return self::err( 'Enter a name of 1 to ' . self::LABEL_MAX . ' characters.', $i );
			}
			$lc = mb_strtolower( $label );
			if ( isset( $labels[ $lc ] ) ) {
				return self::err( "\u{201C}$label\u{201D} is already in this list.", $i );
			}
			$labels[ $lc ] = true;
			$active        = $in['active'] ?? true;
			if ( ! is_bool( $active ) ) {
				return self::err( 'Choose active or archived.', $i );
			}
			$row = array( 'key' => $key, 'label' => $label );
			switch ( $list ) {
				case 'departments':
					$short = self::text( $in['short'] ?? null );
					if ( '' === $short || mb_strlen( $short ) > self::SHORT_MAX ) {
						return self::err( 'Enter a short code of 1 to ' . self::SHORT_MAX . ' characters.', $i );
					}
					$repairs = $in['repairs'] ?? false;
					if ( ! is_bool( $repairs ) ) {
						return self::err( 'Choose whether it handles repairs.', $i );
					}
					$row += array( 'short' => $short, 'repairs' => $repairs );
					break;
				case 'requestTypes':
					$bad = self::dept_problem( $cur, $in['dept'] ?? null, $active );
					if ( null !== $bad ) {
						return self::err( $bad, $i );
					}
					$sla = self::sla( $in['slaMin'] ?? null );
					if ( null === $sla ) {
						return self::err( 'Set a target of 1 to ' . self::SLA_MAX . ' minutes.', $i );
					}
					if ( ! in_array( $in['icon'] ?? null, self::ICONS, true ) ) {
						return self::err( 'Pick an icon from the list.', $i );
					}
					$row += array( 'dept' => $in['dept'], 'slaMin' => $sla, 'icon' => $in['icon'] );
					break;
				case 'bundles':
					$hint = self::text( $in['hint'] ?? '' );
					if ( mb_strlen( $hint ) > self::HINT_MAX ) {
						return self::err( 'Keep the description under ' . self::HINT_MAX . ' characters.', $i );
					}
					$parts = self::parts( $in['parts'] ?? null, $cur, $active );
					if ( is_string( $parts ) ) {
						return self::err( $parts, $i );
					}
					$row += array( 'hint' => $hint, 'parts' => $parts );
					break;
				default: // hold reasons, job titles, findings: key, label, active. A module's list: plus its declared fields.
					$def = self::module_lists()[ $list ] ?? null;
					if ( null === $def ) {
						break;
					}
					$fields = self::module_entry( $def, $in );
					if ( is_string( $fields ) ) {
						return self::err( $fields, $i );
					}
					$row += $fields;
			}
			$row['active'] = $active;
			$out[]         = $row;
		}
		if ( in_array( $list, array( 'departments', 'holdReasons' ), true ) && ! in_array( true, array_column( $out, 'active' ), true ) ) {
			return self::err( 'Keep at least one active ' . self::noun( $list, 0 ) . '.' );
		}
		$taken = $known; // a key that existed stays reserved even if it is being removed now
		foreach ( $out as $row ) {
			$taken[ (string) $row['key'] ] = true;
		}
		foreach ( $out as $i => $row ) {
			if ( null === $row['key'] ) {
				$out[ $i ]['key'] = self::make_key( $row['label'], $taken );
				$taken[ $out[ $i ]['key'] ] = true;
			}
		}
		return $out;
	}

	/** @return array|string the clean parts, or the problem. */
	private static function parts( $parts, array $cur, bool $active ) {
		if ( ! is_array( $parts ) || ! array_is_list( $parts ) || count( $parts ) < 1 || count( $parts ) > self::MAX_PARTS ) {
			return 'A bundle has 1 to ' . self::MAX_PARTS . ' steps.';
		}
		$out = array();
		foreach ( $parts as $j => $p ) {
			$n    = $j + 1;
			$name = is_array( $p ) ? self::text( $p['name'] ?? null ) : '';
			if ( '' === $name || mb_strlen( $name ) > self::LABEL_MAX ) {
				return "Step $n: enter a name of 1 to " . self::LABEL_MAX . ' characters.';
			}
			$bad = self::dept_problem( $cur, $p['dept'] ?? null, $active );
			if ( null !== $bad ) {
				return "Step $n: $bad";
			}
			$sla = self::sla( $p['slaMin'] ?? null );
			if ( null === $sla ) {
				return "Step $n: set a target of 1 to " . self::SLA_MAX . ' minutes.';
			}
			$row   = array( 'name' => $name, 'dept' => $p['dept'], 'slaMin' => $sla );
			$after = $p['after'] ?? null;
			if ( null !== $after ) {
				if ( ! is_int( $after ) || $after < 0 || $after >= $j ) {
					return "Step $n can only wait for an earlier step.";
				}
				$row['after'] = $after;
			}
			$out[] = $row;
		}
		return $out;
	}

	/** "a, b and c" */
	private static function join_words( array $words ): string {
		$last = array_pop( $words );
		return array() === $words ? (string) $last : implode( ', ', $words ) . ' and ' . $last;
	}

	private static function count_words( array $counts ): string {
		$names = array( 'people' => array( 'person', 'people' ), 'requests' => array( 'request', 'requests' ), 'workOrders' => array( 'work order', 'work orders' ) );
		$words = array();
		foreach ( $names as $k => $n ) {
			$c = (int) ( $counts[ $k ] ?? 0 );
			if ( $c > 0 ) {
				$words[] = $c . ' ' . $n[ 1 === $c ? 0 : 1 ];
			}
		}
		return self::join_words( $words );
	}

	/** Names of the request types and bundles that use a department (only the active ones when $active_only). */
	private static function users_of( array $cat, string $dept, bool $active_only ): string {
		$types   = array();
		$bundles = array();
		foreach ( $cat['requestTypes'] as $t ) {
			if ( $t['dept'] === $dept && ( ! $active_only || $t['active'] ) ) {
				$types[] = $t['label'];
			}
		}
		foreach ( $cat['bundles'] as $b ) {
			if ( ( ! $active_only || $b['active'] ) && in_array( $dept, array_column( $b['parts'], 'dept' ), true ) ) {
				$bundles[] = $b['label'];
			}
		}
		$words = array();
		$adj   = $active_only ? 'active ' : '';
		if ( $types ) {
			$words[] = 'the ' . $adj . ( 1 === count( $types ) ? 'request type ' : 'request types ' ) . self::join_words( $types );
		}
		if ( $bundles ) {
			$words[] = 'the ' . $adj . ( 1 === count( $bundles ) ? 'bundle ' : 'bundles ' ) . self::join_words( $bundles );
		}
		return implode( ' and ', $words );
	}

	/** The first referential problem with the new list, or null. */
	private static function in_use( string $list, array $next, array $cur, array $usage ): ?array {
		if ( 'departments' !== $list && 'holdReasons' !== $list ) {
			return null; // request types, bundles, titles and findings are copied into records, never referenced
		}
		$kept = array_column( $next, null, 'key' );
		foreach ( $cur[ $list ] as $old ) {
			$k = $old['key'];
			if ( isset( $kept[ $k ] ) ) {
				continue;
			}
			$counts = (array) ( ( (array) $usage[ $list ] )[ $k ] ?? array() );
			if ( array() !== array_filter( $counts ) ) {
				return self::err( $old['label'] . ' is used by ' . self::count_words( $counts ) . '. Archive it instead.' ) + array( 'key' => $k );
			}
			$users = 'departments' === $list ? self::users_of( $cur, $k, false ) : '';
			if ( '' !== $users ) {
				return self::err( $old['label'] . " is used by $users. Move them to another department or delete them first." ) + array( 'key' => $k );
			}
		}
		if ( 'departments' === $list ) {
			$fixers = array_filter(
				$next,
				static function ( $d ) {
					return $d['active'] && $d['repairs'];
				}
			);
			$open   = self::open_work_orders();
			if ( array() === $fixers && $open > 0 ) {
				return self::err( "$open open work order" . ( 1 === $open ? '' : 's' ) . ' need a department that handles repairs. Keep at least one active one.' );
			}
			foreach ( $next as $i => $d ) {
				$users = $d['active'] ? '' : self::users_of( $cur, $d['key'], true );
				if ( '' !== $users ) {
					return self::err( $d['label'] . " is used by $users. Archive them or move them to another department first.", $i );
				}
			}
		}
		return null;
	}
}
