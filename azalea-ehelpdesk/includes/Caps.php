<?php
/**
 * Roles and capabilities (port of src/server/policy.ts).
 *
 * - azl_manager:    runs the desk, manages staff and settings.
 * - azl_supervisor: runs the desk under their own account, no staff admin, no settings.
 * - azl_device:     a shared phone's account. Opens the desk and runs PIN sign-in; every command
 *                   must name a staff member signed in with a PIN.
 * - administrator:  everything.
 *
 * azl_act_directly marks an account that may act without a PIN (it is recorded as its linked staff
 * row, or "a manager"). Deactivation removes nothing: roles stay so nobody loses access by accident.
 *
 * @package azl-ehd
 */

defined( 'ABSPATH' ) || exit;

final class Azl_Caps {

	const USE_DESK        = 'azl_use_desk';
	const MANAGE_STAFF    = 'azl_manage_staff';
	const MANAGE_SETTINGS = 'azl_manage_settings';
	const DIRECT          = 'azl_act_directly';

	const ROLES = array(
		'azl_manager'    => array( 'E-Help Desk Manager', array( 'read', self::USE_DESK, self::DIRECT, self::MANAGE_STAFF, self::MANAGE_SETTINGS ) ),
		'azl_supervisor' => array( 'E-Help Desk Supervisor', array( 'read', self::USE_DESK, self::DIRECT ) ),
		'azl_device'     => array( 'E-Help Desk Shared Device', array( 'read', self::USE_DESK ) ),
	);

	/** Adds the roles, and every plugin capability to administrators. Safe to run again. */
	public static function install(): void {
		foreach ( self::ROLES as $slug => $def ) {
			list( $label, $caps ) = $def;
			$role = get_role( $slug );
			if ( ! $role ) {
				add_role( $slug, $label, array_fill_keys( $caps, true ) );
				continue;
			}
			foreach ( $caps as $cap ) {
				$role->add_cap( $cap );
			}
		}
		$admin = get_role( 'administrator' );
		if ( $admin ) {
			foreach ( self::all() as $cap ) {
				$admin->add_cap( $cap );
			}
		}
	}

	/** Removes the roles and the administrator's plugin capabilities. Only uninstall.php calls this, on opt-in. */
	public static function uninstall(): void {
		foreach ( array_keys( self::ROLES ) as $slug ) {
			remove_role( $slug );
		}
		$admin = get_role( 'administrator' );
		if ( $admin ) {
			foreach ( self::all() as $cap ) {
				$admin->remove_cap( $cap );
			}
		}
	}

	/** @return string[] */
	public static function all(): array {
		return array( self::USE_DESK, self::DIRECT, self::MANAGE_STAFF, self::MANAGE_SETTINGS );
	}

	/** A shared-device account may not act as itself: with no staff member signed in, its commands are refused. */
	public static function needs_staff( bool $can_act_directly, ?string $actor ): bool {
		return ! $can_act_directly && null === $actor;
	}
}
