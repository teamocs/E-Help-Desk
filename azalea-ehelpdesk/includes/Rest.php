<?php
/**
 * REST routes, namespace azl-ehd/v1. Cookie auth with the X-WP-Nonce header (WordPress core checks
 * the nonce; without it the request runs as a signed-out visitor and every permission check fails).
 *
 * Answers:
 * - 200 {ok:true, ...} or {ok:false, error}: done, or refused for a reason the user can read. A
 *   refused command will never succeed if sent again: drop it from the outbox.
 * - 401/403 {ok:false, error, code}: not signed in, no capability, or no acting staff member. Keep the
 *   command queued and ask for sign-in.
 * - 500 {ok:false, error}: server trouble. Commands are idempotent, so retry with the same opId.
 * Every response carries Cache-Control: no-store. No stack traces are ever sent.
 *
 * @package azl-ehd
 */

defined( 'ABSPATH' ) || exit;

final class Azl_Rest {

	const NS           = 'azl-ehd/v1';
	const ACTOR_HEADER = 'X-Azl-Actor';
	const MAX_BODY     = 65536;

	public static function register_routes(): void {
		$desk  = array( self::class, 'can_use_desk' );
		$staff = array( self::class, 'can_manage_staff' );
		register_rest_route( self::NS, '/snapshot', array( 'methods' => 'GET', 'callback' => array( self::class, 'snapshot' ), 'permission_callback' => $desk ) );
		register_rest_route( self::NS, '/command', array( 'methods' => 'POST', 'callback' => array( self::class, 'command' ), 'permission_callback' => $desk ) );
		register_rest_route(
			self::NS,
			'/poll',
			array(
				'methods'             => 'GET',
				'callback'            => array( self::class, 'poll' ),
				'permission_callback' => $desk,
				'args'                => array(
					'since' => array( 'type' => 'integer', 'minimum' => 0, 'required' => false ),
				),
			)
		);
		register_rest_route( self::NS, '/pin/sign-in', array( 'methods' => 'POST', 'callback' => array( self::class, 'pin_sign_in' ), 'permission_callback' => $desk ) );
		register_rest_route( self::NS, '/pin/sign-out', array( 'methods' => 'POST', 'callback' => array( self::class, 'pin_sign_out' ), 'permission_callback' => $desk ) );
		register_rest_route( self::NS, '/staff', array( 'methods' => 'POST', 'callback' => array( self::class, 'create_staff' ), 'permission_callback' => $staff ) );
		register_rest_route(
			self::NS,
			'/staff/(?P<id>[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})',
			array( 'methods' => 'PATCH', 'callback' => array( self::class, 'update_staff' ), 'permission_callback' => $staff )
		);
	}

	/* ---------- permissions ---------- */

	public static function can_use_desk(): bool {
		return current_user_can( Azl_Caps::USE_DESK );
	}

	public static function can_manage_staff(): bool {
		return current_user_can( Azl_Caps::MANAGE_STAFF );
	}

	public static function can_manage_settings(): bool {
		return current_user_can( Azl_Caps::MANAGE_SETTINGS );
	}

	/* ---------- routes ---------- */

	/** GET /snapshot */
	public static function snapshot( $request ) {
		return self::guard(
			static function () {
				return self::reply( Azl_Snapshot::load() );
			}
		);
	}

	/**
	 * POST /command. Body: one Command object from src/server/contract.ts. Header X-Azl-Actor: the
	 * token from /pin/sign-in (required on a shared-device account).
	 */
	public static function command( $request ) {
		return self::guard(
			static function () use ( $request ) {
				$cmd = self::body( $request );
				if ( null === $cmd || ! is_string( $cmd['type'] ?? null ) ) {
					return self::reply( array( 'ok' => false, 'error' => 'Unknown command' ), 400 );
				}
				$actor = Azl_Staff::actor_for( get_current_user_id(), $request->get_header( self::ACTOR_HEADER ) );
				if ( ! $actor['ok'] ) {
					return self::reply( array( 'ok' => false, 'error' => $actor['error'], 'code' => 'azl_needs_pin' ), 403 );
				}
				return self::reply( Azl_Commands::apply( $cmd, $actor['staff'] ) );
			}
		);
	}

	/** GET /poll?since=<rev>: one indexed single-row read. 304 when the ETag still matches. */
	public static function poll( $request ) {
		return self::guard(
			static function () use ( $request ) {
				$rev  = Azl_Db::counter( 'change' );
				$etag = '"azl-' . $rev . '"';
				if ( trim( (string) $request->get_header( 'If-None-Match' ) ) === $etag ) {
					return self::reply( null, 304, array( 'ETag' => $etag ) );
				}
				$since = $request->get_param( 'since' );
				$since = is_numeric( $since ) ? max( 0, (int) $since ) : -1;
				return self::reply( array( 'ok' => true, 'rev' => $rev, 'changed' => $rev !== $since ), 200, array( 'ETag' => $etag ) );
			}
		);
	}

	/** POST /pin/sign-in {staffId, pin} -> {ok:true, token, expiresAt, staff:{id, name}} or {ok:false, error}. */
	public static function pin_sign_in( $request ) {
		return self::guard(
			static function () use ( $request ) {
				$b     = self::body( $request ) ?? array();
				$id    = $b['staffId'] ?? null;
				$check = Azl_Staff::check_pin( $id, $b['pin'] ?? null );
				if ( ! $check['ok'] ) {
					return self::reply( $check );
				}
				$id   = strtolower( $id );
				$name = Azl_Db::val( 'SELECT name FROM ' . Azl_Db::t( 'staff' ) . ' WHERE id = %s', array( $id ) );
				$tok  = Azl_Pin::sign_actor( get_current_user_id(), $id );
				return self::reply( array( 'ok' => true, 'token' => $tok['token'], 'expiresAt' => $tok['expiresAt'], 'staff' => array( 'id' => $id, 'name' => $name ) ) );
			}
		);
	}

	/** POST /pin/sign-out: voids every acting token of this WordPress user. */
	public static function pin_sign_out( $request ) {
		return self::guard(
			static function () {
				Azl_Pin::sign_out( get_current_user_id() );
				return self::reply( array( 'ok' => true ) );
			}
		);
	}

	/** POST /staff {name, title, role, dept|null, pin, wpUserId?} -> {ok:true, id} or {ok:false, error}. */
	public static function create_staff( $request ) {
		return self::guard(
			static function () use ( $request ) {
				$b = self::body( $request );
				if ( null === $b ) {
					return self::reply( array( 'ok' => false, 'error' => 'Send the person as JSON.' ), 400 );
				}
				return self::reply( Azl_Staff::create( $b, $b['pin'] ?? null ) );
			}
		);
	}

	/** PATCH /staff/<id> {name?, title?, role?, dept?, onShift?, active?, pin?, wpUserId?} -> {ok:true} or {ok:false, error}. */
	public static function update_staff( $request ) {
		return self::guard(
			static function () use ( $request ) {
				$b = self::body( $request );
				if ( null === $b ) {
					return self::reply( array( 'ok' => false, 'error' => 'Send the changes as JSON.' ), 400 );
				}
				$allowed = array_flip( array( 'name', 'title', 'role', 'dept', 'onShift', 'active', 'pin', 'wpUserId' ) );
				return self::reply( Azl_Staff::update( $request->get_param( 'id' ), array_intersect_key( $b, $allowed ) ) );
			}
		);
	}

	/* ---------- plumbing ---------- */

	/** The JSON body as an array, or null when missing, too big or not an object. */
	private static function body( $request ): ?array {
		$raw = (string) $request->get_body();
		if ( strlen( $raw ) > self::MAX_BODY ) {
			return null;
		}
		$b = $request->get_json_params();
		return is_array( $b ) && ! array_is_list( $b ) ? $b : null;
	}

	private static function reply( $data, int $status = 200, array $headers = array() ): WP_REST_Response {
		$r = new WP_REST_Response( $data, $status );
		$r->header( 'Cache-Control', 'no-store, max-age=0' );
		$r->header( 'Pragma', 'no-cache' );
		foreach ( $headers as $k => $v ) {
			$r->header( $k, $v );
		}
		return $r;
	}

	private static function guard( callable $fn ): WP_REST_Response {
		try {
			return $fn();
		} catch ( Throwable $e ) {
			error_log( 'azl-ehd REST error: ' . $e->getMessage() );
			return self::reply( array( 'ok' => false, 'error' => Azl_Commands::ERROR ), 500 );
		}
	}
}
