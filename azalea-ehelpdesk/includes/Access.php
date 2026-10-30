<?php
/**
 * Who may see and change each desk module: the role matrix of docs/MODULES-SPEC.md B.3, in one place.
 *
 * Actor kinds:
 * - owner, manager, supervisor: the WordPress account's role (Hotel Owner or administrator, Manager, Supervisor).
 *   The account's role decides even while someone acts with a PIN on it.
 * - hdo, staff, supervisor, manager: on a shared phone (azl_device), the job role of the staff member acting with
 *   a PIN (help-desk officer, department staff with their department, supervisor, manager).
 * - none: no desk access, or a shared phone with nobody signed in.
 *
 * Levels: none (hidden), read (sees, cannot change), own (own department or own items; see level()), full.
 *
 * The server is the authority: every command belongs to a module and is refused here when the actor's level is
 * too low (Azl_Commands::run), and the snapshot only carries the module slices the actor may read. The desk gets
 * the same matrix in window.AZL to hide what the server would refuse.
 *
 * @package azl-ehd
 */

defined( 'ABSPATH' ) || exit;

final class Azl_Access {

	const LEVELS = array( 'none', 'read', 'own', 'full' );
	const KINDS  = array( 'owner', 'manager', 'supervisor', 'hdo', 'staff' );

	/** The sidebar, in order: module id => label (the client prototype's labels). */
	const LABELS = array(
		'dashboard'   => 'Dashboard',
		'requests'    => 'Requests',
		'inquiries'   => 'Inquiries',
		'cleaning'    => 'Cleaning',
		'workorders'  => 'Work Orders',
		'housestatus' => 'House Status',
		'crisis'      => 'Crisis Mgmt',
		'transport'   => 'Transport',
		'reminders'   => 'Reminders',
		'reports'     => 'Reports',
		'config'      => 'Configuration',
	);

	/**
	 * Module x kind => level. B.3 of docs/MODULES-SPEC.md, with these readings (defaults until the client confirms):
	 * Work Orders "V (report)" for a help-desk officer is full; Crisis "log + update" is own (no close); Reminders
	 * "own + All HD" is own; Configuration "own prefs only" is own (preferences live on the device; lists, staff and
	 * logins keep their own capabilities). Mirrored in src/modules/access.ts (a test keeps the two equal).
	 */
	const MATRIX = array(
		'dashboard'   => array( 'owner' => 'full', 'manager' => 'full', 'supervisor' => 'full', 'hdo' => 'full', 'staff' => 'none' ),
		'requests'    => array( 'owner' => 'full', 'manager' => 'full', 'supervisor' => 'full', 'hdo' => 'full', 'staff' => 'own' ),
		'inquiries'   => array( 'owner' => 'full', 'manager' => 'full', 'supervisor' => 'full', 'hdo' => 'full', 'staff' => 'none' ),
		'cleaning'    => array( 'owner' => 'full', 'manager' => 'full', 'supervisor' => 'full', 'hdo' => 'full', 'staff' => 'own' ),
		'workorders'  => array( 'owner' => 'full', 'manager' => 'full', 'supervisor' => 'full', 'hdo' => 'full', 'staff' => 'own' ),
		'housestatus' => array( 'owner' => 'full', 'manager' => 'full', 'supervisor' => 'full', 'hdo' => 'full', 'staff' => 'read' ),
		'crisis'      => array( 'owner' => 'full', 'manager' => 'full', 'supervisor' => 'full', 'hdo' => 'own', 'staff' => 'own' ),
		'transport'   => array( 'owner' => 'full', 'manager' => 'full', 'supervisor' => 'full', 'hdo' => 'full', 'staff' => 'own' ),
		'reminders'   => array( 'owner' => 'full', 'manager' => 'full', 'supervisor' => 'full', 'hdo' => 'own', 'staff' => 'none' ),
		'reports'     => array( 'owner' => 'full', 'manager' => 'full', 'supervisor' => 'read', 'hdo' => 'none', 'staff' => 'none' ),
		'config'      => array( 'owner' => 'full', 'manager' => 'full', 'supervisor' => 'read', 'hdo' => 'own', 'staff' => 'own' ),
	);

	/** The module each built-in command belongs to. Module commands name theirs (Azl_Modules). */
	const COMMANDS = array(
		'logRequest'        => 'requests',
		'completeRequest'   => 'requests',
		'relay'             => 'requests',
		'onSite'            => 'requests',
		'resume'            => 'requests',
		'hold'              => 'requests',
		'finish'            => 'requests',
		'transfer'          => 'requests',
		'escalate'          => 'requests',
		'undoEscalate'      => 'requests',
		'ackHandover'       => 'dashboard',
		'returnOrphans'     => 'dashboard',
		'assessWo'          => 'workorders',
		'startWo'           => 'workorders',
		'holdWo'            => 'workorders',
		'completeWo'        => 'workorders',
		'reopenWo'          => 'workorders',
		'cleanSet'          => 'cleaning',
		'raiseSafety'       => 'crisis',
		'downgradeIncident' => 'crisis',
		'record911'         => 'crisis',
		'resolveIncident'   => 'crisis',
	);

	/** Commands that need full access; every other command needs own or full. Resolving a safety alert is a sign-off. */
	const NEEDS_FULL = array( 'resolveIncident' );

	/** Built-in commands acting on one request item: with own access, only items of the actor's department. */
	const ITEM_SCOPED = array( 'relay', 'onSite', 'resume', 'hold', 'finish', 'transfer', 'escalate', 'undoEscalate' );

	/** The department whose staff run Cleaning ("Housekeeping only" in B.3). */
	const CLEANING_DEPT = 'housekeeping';

	const NO_PIN = 'Sign in with your PIN first.';
	const OWN    = 'You can only work on items of your own department.';
	/** Read access to a module that has a report command (Work Orders for a department that does not handle repairs). */
	const REPORT_ONLY = 'You can report a new one in %s, but only the help desk or the team that handles it can change it.';

	/* ---------- who is acting ---------- */

	/**
	 * The actor kind and department for a WordPress user and the staff member acting with a PIN (or null), and that
	 * staff id (staff: lower case, or null), so modules never read the X-Azl-Actor header again.
	 *
	 * @return array{kind: string, dept: ?string, staff: ?string}
	 */
	public static function who( int $user_id, ?string $staff_id ): array {
		$staff = null === $staff_id ? null : strtolower( $staff_id );
		if ( $user_id <= 0 || ! user_can( $user_id, Azl_Caps::USE_DESK ) ) {
			return array( 'kind' => 'none', 'dept' => null, 'staff' => null );
		}
		if ( user_can( $user_id, Azl_Caps::DIRECT ) ) {
			// Same order as azl_ehd_desk_role(): administrators hold every azl_* capability.
			if ( user_can( $user_id, Azl_Caps::MANAGE_ACCOUNTS ) ) {
				return array( 'kind' => 'owner', 'dept' => null, 'staff' => $staff );
			}
			return array( 'kind' => user_can( $user_id, Azl_Caps::MANAGE_STAFF ) ? 'manager' : 'supervisor', 'dept' => null, 'staff' => $staff );
		}
		return self::staff_kind( $staff_id );
	}

	/** A shared phone acts as the job role of the staff member signed in with a PIN. */
	public static function staff_kind( ?string $staff_id ): array {
		$row = null === $staff_id ? null : Azl_Db::row( 'SELECT role, dept FROM ' . Azl_Db::t( 'staff' ) . ' WHERE id = %s AND active = 1', array( strtolower( $staff_id ) ) );
		if ( null === $row ) {
			return array( 'kind' => 'none', 'dept' => null, 'staff' => null );
		}
		$kind = array(
			'hdo'        => 'hdo',
			'staff'      => 'staff',
			'supervisor' => 'supervisor',
			'manager'    => 'manager',
			'owner'      => 'manager',
		)[ $row['role'] ] ?? 'none';
		return array( 'kind' => $kind, 'dept' => $row['dept'], 'staff' => strtolower( $staff_id ) );
	}

	/* ---------- levels ---------- */

	/** The matrix row of a module: the built-in matrix, else the module's own capabilities(). */
	public static function row( string $module ): array {
		if ( isset( self::MATRIX[ $module ] ) ) {
			return self::MATRIX[ $module ];
		}
		$m   = class_exists( 'Azl_Modules' ) ? Azl_Modules::get( $module ) : null;
		$out = array();
		foreach ( null === $m ? array() : $m->capabilities() as $kind => $level ) {
			if ( in_array( $kind, self::KINDS, true ) && in_array( $level, self::LEVELS, true ) ) {
				$out[ $kind ] = $level;
			}
		}
		return $out;
	}

	/**
	 * The actor's level on a module. Department staff's "own" is resolved where B.3 names departments:
	 * Cleaning is Housekeeping only; Work Orders is full for a department that handles repairs, else read, which
	 * still lets them report one (B.3 "report only": a command declared need 'report', see refusal()). Elsewhere
	 * "own" stays: the module limits rows itself.
	 */
	public static function level( string $module, array $who ): string {
		$level = self::row( $module )[ $who['kind'] ?? 'none' ] ?? 'none';
		if ( 'own' !== $level || 'staff' !== $who['kind'] ) {
			return $level;
		}
		if ( 'cleaning' === $module ) {
			return self::CLEANING_DEPT === $who['dept'] ? 'full' : 'none';
		}
		if ( 'workorders' === $module ) {
			$dept = Azl_Catalog::active( Azl_Catalog::get(), 'departments', $who['dept'] );
			return null !== $dept && true === $dept['repairs'] ? 'full' : 'read';
		}
		return $level;
	}

	/** Every module the actor may see, in sidebar order, then registered modules: id => level (none left out). */
	public static function levels( array $who ): array {
		$ids = array_keys( self::LABELS );
		if ( class_exists( 'Azl_Modules' ) ) {
			$ids = array_values( array_unique( array_merge( $ids, array_keys( Azl_Modules::all() ) ) ) );
		}
		$out = array();
		foreach ( $ids as $id ) {
			$l = self::level( $id, $who );
			if ( 'none' !== $l ) {
				$out[ $id ] = $l;
			}
		}
		return $out;
	}

	/** The whole matrix for the desk (window.AZL.access): module => kind => level, registered modules included. */
	public static function matrix(): array {
		$out = self::MATRIX;
		if ( class_exists( 'Azl_Modules' ) ) {
			foreach ( array_keys( Azl_Modules::all() ) as $id ) {
				$out[ $id ] = $out[ $id ] ?? self::row( $id );
			}
		}
		return $out;
	}

	/* ---------- commands ---------- */

	/** The module a command type belongs to, or null for an unknown type. */
	public static function module_of( string $type ): ?string {
		if ( isset( self::COMMANDS[ $type ] ) ) {
			return self::COMMANDS[ $type ];
		}
		$def = class_exists( 'Azl_Modules' ) ? Azl_Modules::command( $type ) : null;
		return null === $def ? null : $def['module'];
	}

	private static function label( string $module ): string {
		return self::LABELS[ $module ] ?? ucfirst( $module );
	}

	/**
	 * Why this actor may not run this command, or null when allowed. Reads only (call inside the command's
	 * transaction, before its claim).
	 */
	public static function refusal( array $cmd, array $who ): ?string {
		$type   = is_string( $cmd['type'] ?? null ) ? $cmd['type'] : '';
		$module = self::module_of( $type );
		if ( null === $module ) {
			return 'Unknown command';
		}
		if ( 'none' === $who['kind'] ) {
			return self::NO_PIN;
		}
		$level = self::level( $module, $who );
		$def   = isset( self::COMMANDS[ $type ] ) ? null : Azl_Modules::command( $type );
		$need  = in_array( $type, self::NEEDS_FULL, true ) || 'full' === ( $def['need'] ?? null ) ? 'full' : 'own';
		if ( 'none' === $level ) {
			return 'Your role cannot use ' . self::label( $module ) . '.';
		}
		if ( 'read' === $level && 'report' === ( $def['need'] ?? null ) ) {
			return null; // reporting a new record needs only read access (B.3 "report only")
		}
		if ( 'read' === $level ) {
			return self::reports( $module ) ? sprintf( self::REPORT_ONLY, self::label( $module ) ) : 'Your role can only view ' . self::label( $module ) . '.';
		}
		if ( 'own' === $level && 'full' === $need ) {
			return 'Only a supervisor or manager can do this in ' . self::label( $module ) . '.';
		}
		if ( 'own' === $level ) {
			return self::outside_own( $type, $cmd, $who, $def );
		}
		return null;
	}

	/** True when one of the module's commands may be run with read access (need 'report'). */
	private static function reports( string $module ): bool {
		$m = class_exists( 'Azl_Modules' ) ? Azl_Modules::get( $module ) : null;
		foreach ( null === $m ? array() : $m->commands() as $def ) {
			if ( 'report' === ( $def['need'] ?? null ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * With own access: the row must belong to the actor's department (requests) or pass the module's scope check. A
	 * module may word its own refusal (Azl_Module::ownRefusal), else the department message.
	 */
	private static function outside_own( string $type, array $cmd, array $who, ?array $def ): ?string {
		if ( null !== $def ) {
			if ( ! isset( $def['scope'] ) || true === ( $def['scope'] )( $cmd, $who ) ) {
				return null;
			}
			$m = Azl_Modules::get( $def['module'] );
			return ( null === $m ? null : $m->ownRefusal( $type ) ) ?? self::OWN;
		}
		if ( ! in_array( $type, self::ITEM_SCOPED, true ) || 'staff' !== $who['kind'] ) {
			return null;
		}
		$dept = Azl_Db::val( 'SELECT dept FROM ' . Azl_Db::t( 'items' ) . ' WHERE id = %s', array( (string) ( $cmd['itemId'] ?? '' ) ) );
		// An unknown item falls through to the command's own "Unknown item" answer.
		return null !== $dept && $dept !== $who['dept'] ? self::OWN : null;
	}
}
