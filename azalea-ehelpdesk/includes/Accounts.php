<?php
/**
 * Desk accounts without wp-admin: the hotel owner (azl_manage_accounts; administrators too) lists,
 * creates and switches off the WordPress accounts of managers, supervisors and shared phones.
 *
 * - Only those three roles are ever listed or touched. Administrators and owners are invisible here,
 *   except the caller, who is listed first as "owner". A refused target answers 404, like a missing one.
 * - A new account gets user_login = email, a random password it never sees, and an email with a link
 *   to /helpdesk/reset/ to choose its own password.
 * - Switching an account off sets the user meta azl_disabled, ends every session and PIN sign-in.
 *   It can be switched on again. There is no delete route.
 * - Not written to azl_events: that log is keyed by desk-record uuids and has no account entity, and
 *   its schema is not changed for this.
 *
 * @package azl-ehd
 */

defined( 'ABSPATH' ) || exit;

final class Azl_Accounts {

	const NOT_FOUND = 'No such account.';
	const EXISTS    = 'An account with that email already exists.';
	const FAILED    = 'Could not create the account. Try again.';

	public static function register_routes(): void {
		$can = array( self::class, 'can_manage' );
		register_rest_route(
			Azl_Rest::NS,
			'/accounts',
			array(
				array( 'methods' => 'GET', 'callback' => array( self::class, 'list' ), 'permission_callback' => $can ),
				array( 'methods' => 'POST', 'callback' => array( self::class, 'create' ), 'permission_callback' => $can ),
			)
		);
		register_rest_route( Azl_Rest::NS, '/accounts/(?P<id>[0-9]{1,20})', array( 'methods' => 'PATCH', 'callback' => array( self::class, 'update' ), 'permission_callback' => $can ) );
	}

	public static function can_manage(): bool {
		return current_user_can( Azl_Caps::MANAGE_ACCOUNTS );
	}

	/** owner|manager|supervisor|device for an account, or null when it is not one an owner may manage. */
	public static function managed_role( $user ): ?string {
		$roles = (array) ( $user->roles ?? array() );
		if ( in_array( 'administrator', $roles, true ) || in_array( 'azl_owner', $roles, true ) || user_can( $user, 'manage_options' ) || user_can( $user, Azl_Caps::MANAGE_ACCOUNTS ) ) {
			return null;
		}
		foreach ( Azl_Caps::MANAGED as $slug => $name ) {
			if ( in_array( $slug, $roles, true ) ) {
				return $name;
			}
		}
		return null;
	}

	private static function row( $user, string $role ): array {
		return array(
			'id'       => (int) $user->ID,
			'name'     => (string) $user->display_name,
			'email'    => (string) $user->user_email,
			'role'     => $role,
			'disabled' => Azl_Auth::is_disabled( $user->ID ),
		);
	}

	/** GET /accounts -> {ok:true, accounts:[{id, name, email, role, disabled, self?}]} */
	public static function list( $request ) {
		return self::guard(
			static function () {
				$me  = wp_get_current_user();
				$out = array( self::row( $me, 'owner' ) + array( 'self' => true ) );
				$users = get_users(
					array(
						'role__in' => array_keys( Azl_Caps::MANAGED ),
						'orderby'  => 'display_name',
						'order'    => 'ASC',
						'number'   => 500,
					)
				);
				foreach ( $users as $u ) {
					$role = (int) $u->ID === (int) $me->ID ? null : self::managed_role( $u );
					if ( null !== $role ) {
						$out[] = self::row( $u, $role );
					}
				}
				return self::reply( array( 'ok' => true, 'accounts' => $out ) );
			}
		);
	}

	/** POST /accounts {name, email, role: manager|supervisor|device} -> 201 {ok:true, account} | 400/409 {ok:false, error} */
	public static function create( $request ) {
		return self::guard(
			static function () use ( $request ) {
				$b     = self::body( $request );
				$name  = sanitize_text_field( (string) ( is_string( $b['name'] ?? null ) ? $b['name'] : '' ) );
				$email = strtolower( trim( is_string( $b['email'] ?? null ) ? $b['email'] : '' ) );
				$slug  = array_search( $b['role'] ?? null, Azl_Caps::MANAGED, true );
				if ( '' === $name || mb_strlen( $name ) > 80 ) {
					return self::reply( array( 'ok' => false, 'error' => 'Enter a name (up to 80 characters).' ), 400 );
				}
				if ( strlen( $email ) > 100 || ! is_email( $email ) || sanitize_email( $email ) !== $email ) {
					return self::reply( array( 'ok' => false, 'error' => 'Enter a valid email address.' ), 400 );
				}
				if ( false === $slug ) {
					return self::reply( array( 'ok' => false, 'error' => 'Choose manager, supervisor or shared phone.' ), 400 );
				}
				if ( email_exists( $email ) || username_exists( $email ) ) {
					return self::reply( array( 'ok' => false, 'error' => self::EXISTS ), 409 );
				}
				$id = wp_insert_user(
					array(
						'user_login'   => $email,
						'user_email'   => $email,
						'user_pass'    => wp_generate_password( 32, true, true ),
						'display_name' => $name,
						'nickname'     => $name,
						'first_name'   => $name,
						'role'         => $slug,
					)
				);
				if ( is_wp_error( $id ) || ! $id ) {
					return self::reply( array( 'ok' => false, 'error' => self::FAILED ), 500 );
				}
				$user = get_userdata( $id );
				$sent = $user ? Azl_Auth::send_link( $user, true ) : false;
				return self::reply( array( 'ok' => true, 'account' => self::row( $user, Azl_Caps::MANAGED[ $slug ] ), 'emailSent' => $sent ), 201 );
			}
		);
	}

	/** PATCH /accounts/<id> {disabled: bool} -> {ok:true, account} | 400 | 404 */
	public static function update( $request ) {
		return self::guard(
			static function () use ( $request ) {
				$b    = self::body( $request );
				$id   = (int) $request->get_param( 'id' );
				$user = $id > 0 && $id !== get_current_user_id() ? get_userdata( $id ) : false;
				$role = $user ? self::managed_role( $user ) : null;
				if ( null === $role ) {
					return self::reply( array( 'ok' => false, 'error' => self::NOT_FOUND ), 404 );
				}
				if ( ! is_bool( $b['disabled'] ?? null ) ) {
					return self::reply( array( 'ok' => false, 'error' => 'Send {"disabled": true} or {"disabled": false}.' ), 400 );
				}
				if ( $b['disabled'] ) {
					update_user_meta( $id, Azl_Auth::DISABLED, 1 );
					WP_Session_Tokens::get_instance( $id )->destroy_all();
					Azl_Pin::sign_out( $id );
				} else {
					delete_user_meta( $id, Azl_Auth::DISABLED );
				}
				return self::reply( array( 'ok' => true, 'account' => self::row( $user, $role ) ) );
			}
		);
	}

	private static function body( $request ): array {
		if ( strlen( (string) $request->get_body() ) > 8192 ) {
			return array();
		}
		$b = $request->get_json_params();
		return is_array( $b ) ? $b : array();
	}

	private static function reply( $data, int $status = 200 ): WP_REST_Response {
		$r = new WP_REST_Response( $data, $status );
		$r->header( 'Cache-Control', 'no-store, max-age=0' );
		return $r;
	}

	private static function guard( callable $fn ): WP_REST_Response {
		try {
			return $fn();
		} catch ( Throwable $e ) {
			error_log( 'azl-ehd accounts error: ' . get_class( $e ) . ' at ' . basename( $e->getFile() ) . ':' . $e->getLine() );
			return self::reply( array( 'ok' => false, 'error' => 'Something went wrong. Try again.' ), 500 );
		}
	}
}
