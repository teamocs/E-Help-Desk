<?php
/**
 * Roles, capabilities and the wp-admin lockdown.
 *
 * - azl_owner:      Hotel Owner. Runs the desk, manages staff and the hotel's desk accounts.
 * - azl_manager:    Manager. Runs the desk, manages staff.
 * - azl_supervisor: Supervisor. Runs the desk under their own account.
 * - azl_device:     Shared phone. Opens the desk; every action needs a staff PIN.
 * - administrator:  every azl_* capability (the agency, OCS). The only accounts that use wp-admin.
 *
 * The desk roles hold no core WordPress capability: `read` is stored as false. WordPress still signs
 * such users in (wp_signon() checks no capability); wp-admin refuses them, and lockdown() sends them
 * to the desk before WordPress shows its "not allowed" screen.
 *
 * azl_act_directly marks an account that may act without a PIN (recorded as its linked staff row, or
 * "a manager"). Deactivation removes nothing: roles stay so nobody loses access by accident.
 *
 * @package azl-ehd
 */

defined( 'ABSPATH' ) || exit;

final class Azl_Caps {

	const USE_DESK        = 'azl_use_desk';
	const MANAGE_STAFF    = 'azl_manage_staff';
	const MANAGE_SETTINGS = 'azl_manage_settings';
	const MANAGE_ACCOUNTS = 'azl_manage_accounts';
	const DIRECT          = 'azl_act_directly';

	/** Bump when ROLES changes: maybe_upgrade() re-applies them once on every site. */
	const ROLES_VERSION = '2';
	const ROLES_OPTION  = 'azl_roles_version';

	const ROLES = array(
		'azl_owner'      => array( 'Hotel Owner', array( self::USE_DESK, self::DIRECT, self::MANAGE_STAFF, self::MANAGE_ACCOUNTS ) ),
		'azl_manager'    => array( 'Manager', array( self::USE_DESK, self::DIRECT, self::MANAGE_STAFF ) ),
		'azl_supervisor' => array( 'Supervisor', array( self::USE_DESK, self::DIRECT ) ),
		'azl_device'     => array( 'Shared phone', array( self::USE_DESK ) ),
	);

	/** The roles an owner may create and switch off (never an owner or an administrator). */
	const MANAGED = array(
		'azl_manager'    => 'manager',
		'azl_supervisor' => 'supervisor',
		'azl_device'     => 'device',
	);

	/** The exact capability map each role must hold: its azl_* caps, and read stored as false. */
	public static function role_caps( string $slug ): array {
		return array( 'read' => false ) + array_fill_keys( self::ROLES[ $slug ][1], true );
	}

	/**
	 * Adds or repairs the roles and gives administrators every plugin capability. Safe to run again.
	 * An existing role is brought to exactly role_caps(): stray capabilities (core ones added by hand,
	 * the retired azl_manage_settings on managers) are removed. Users keep their roles.
	 */
	public static function install(): void {
		foreach ( self::ROLES as $slug => $def ) {
			$want = self::role_caps( $slug );
			$role = get_role( $slug );
			if ( ! $role ) {
				add_role( $slug, $def[0], $want );
				continue;
			}
			foreach ( array_keys( (array) $role->capabilities ) as $cap ) {
				if ( ! array_key_exists( $cap, $want ) ) {
					$role->remove_cap( $cap );
				}
			}
			foreach ( $want as $cap => $grant ) {
				if ( ( $role->capabilities[ $cap ] ?? null ) !== $grant ) {
					$role->add_cap( $cap, $grant );
				}
			}
			self::rename( $slug, $def[0] );
		}
		$admin = get_role( 'administrator' );
		if ( $admin ) {
			foreach ( self::all() as $cap ) {
				$admin->add_cap( $cap );
			}
		}
		update_option( self::ROLES_OPTION, self::ROLES_VERSION );
	}

	/** Runs install() once after an update that changed the roles (cheap autoloaded option read). */
	public static function maybe_upgrade(): void {
		if ( get_option( self::ROLES_OPTION ) !== self::ROLES_VERSION ) {
			self::install();
		}
	}

	/** Keeps the role's display name current (WordPress has no API for it). */
	private static function rename( string $slug, string $label ): void {
		if ( ! function_exists( 'wp_roles' ) ) {
			return;
		}
		$wr = wp_roles();
		if ( isset( $wr->roles[ $slug ] ) && $wr->roles[ $slug ]['name'] !== $label ) {
			$wr->roles[ $slug ]['name'] = $label;
			$wr->role_names[ $slug ]    = $label;
			if ( $wr->use_db ) {
				update_option( $wr->role_key, $wr->roles );
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
		delete_option( self::ROLES_OPTION );
	}

	/** @return string[] */
	public static function all(): array {
		return array( self::USE_DESK, self::DIRECT, self::MANAGE_STAFF, self::MANAGE_SETTINGS, self::MANAGE_ACCOUNTS );
	}

	/** A shared-device account may not act as itself: with no staff member signed in, its commands are refused. */
	public static function needs_staff( bool $can_act_directly, ?string $actor ): bool {
		return ! $can_act_directly && null === $actor;
	}

	/* ---------- lockdown: desk accounts never see wp-admin ---------- */

	/** True for a signed-in account holding a desk role and no administrator power. */
	public static function locked( $user ): bool {
		if ( ! is_object( $user ) || empty( $user->ID ) ) {
			return false;
		}
		$desk_roles = array_intersect( (array) ( $user->roles ?? array() ), array_keys( self::ROLES ) );
		return array() !== $desk_roles && ! user_can( $user, 'manage_options' );
	}

	/**
	 * Where a wp-admin request must go instead, or null to let it through. admin-ajax.php and
	 * admin-post.php stay open (front-end plugins use them); REST never runs admin_init.
	 */
	public static function admin_redirect( $user, string $pagenow, bool $ajax ): ?string {
		if ( $ajax || 'admin-post.php' === $pagenow || ! self::locked( $user ) ) {
			return null;
		}
		return azl_ehd_desk_url();
	}

	public static function hooks(): void {
		add_action( 'init', array( self::class, 'maybe_upgrade' ), 1 );
		add_action( 'admin_init', array( self::class, 'guard_admin' ), 0 );
		// Without `read`, wp-admin/includes/menu.php refuses the page before admin_init runs: redirect there too.
		add_action( 'admin_page_access_denied', array( self::class, 'guard_admin' ), 0 );
		add_action( 'personal_options_update', array( self::class, 'guard_profile' ), 0 );
		add_filter( 'show_admin_bar', array( self::class, 'admin_bar' ) );
		add_filter( 'login_redirect', array( self::class, 'login_redirect' ), 99, 3 );
	}

	public static function guard_admin(): void {
		$to = self::admin_redirect( wp_get_current_user(), (string) ( $GLOBALS['pagenow'] ?? '' ), wp_doing_ajax() );
		if ( null !== $to ) {
			wp_safe_redirect( $to );
			exit;
		}
	}

	/** Belt and braces: a desk account never saves its own profile through wp-admin. */
	public static function guard_profile(): void {
		if ( self::locked( wp_get_current_user() ) ) {
			wp_die( esc_html__( 'Profile changes are made by your hotel owner or manager.', 'azl-ehd' ), '', array( 'response' => 403 ) );
		}
	}

	public static function admin_bar( $show ) {
		return self::locked( wp_get_current_user() ) ? false : $show;
	}

	/** After any sign-in (wp-login.php included) a desk account lands on the desk, or a safe desk page it asked for. */
	public static function login_redirect( $redirect_to, $requested, $user ) {
		return self::locked( $user ) ? Azl_Auth::safe_redirect( $requested ) : $redirect_to;
	}
}
