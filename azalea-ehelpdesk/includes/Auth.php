<?php
/**
 * The help desk's own sign-in: /helpdesk/login/, /helpdesk/forgot/, /helpdesk/reset/, and the REST
 * routes they post to (namespace azl-ehd/v1, under /auth/).
 *
 * Security notes
 * - CSRF: the page carries a token: "<unix time>.<HMAC-SHA256(time | sha256(ip | user agent))>", keyed
 *   from the site secret (option azl_secret, see Azl_Pin). Valid 2 hours, bound to the client's address
 *   and browser. A cross-site Origin header is refused as well. Tokens are never returned by REST.
 * - Enumeration: an unknown account, a wrong password, a disabled account and an account without
 *   desk access all answer 401 with the same text, after the same password-hash work.
 * - Rate limits (transients):
 *     sign-in   5 failures per account + address in 15 minutes lock that pair for 15 minutes;
 *               20 failures per address in an hour lock the address for an hour;
 *     forgot    3 requests per hour per email and per address;
 *     reset     3 attempts per hour per account and per address.
 *   Over a limit: 429, "Too many attempts. Try again in N minutes.", and Retry-After.
 *   The address is REMOTE_ADDR. Only with the option azl_trust_proxy_headers on (default off) is the
 *   right-most valid X-Forwarded-For entry used (the one the trusted proxy added).
 * - Sessions (auth_cookie_expiration): shared phones 30 days; owner, manager and supervisor 7 days
 *   with "Keep me signed in", else 12 hours. Administrators keep WordPress's default.
 * - No password, key or token is ever logged or echoed back.
 *
 * @package azl-ehd
 */

defined( 'ABSPATH' ) || exit;

final class Azl_Auth {

	const FAILED   = 'That email and password do not match.';
	const EXPIRED  = 'This page has expired. Reload it and try again.';
	const SENT     = 'If that email has an account, a link is on its way.';
	const BAD_LINK = 'This link has expired or was already used. Request a new one.';
	const SAVED    = 'Your password is saved. You can sign in now.';
	const ERROR    = 'Something went wrong. Try again.';
	const DISABLED = 'azl_disabled';

	const CSRF_TTL     = 7200;
	const PAIR_MAX     = 5;
	const PAIR_WINDOW  = 900;
	const IP_MAX       = 20;
	const IP_WINDOW    = 3600;
	const MAIL_MAX     = 3;
	const MAIL_WINDOW  = 3600;
	const MIN_PASSWORD = 10;

	const PAGES = array( 'login', 'forgot', 'reset' );

	/* ---------- wiring ---------- */

	public static function hooks(): void {
		add_filter( 'auth_cookie_expiration', array( self::class, 'cookie_expiration' ), 20, 3 );
		// Disabled accounts cannot sign in anywhere, wp-login.php included.
		add_filter( 'authenticate', array( self::class, 'refuse_disabled' ), 99 );
	}

	public static function register_routes(): void {
		$open = '__return_true';
		register_rest_route( Azl_Rest::NS, '/auth/login', array( 'methods' => 'POST', 'callback' => array( self::class, 'login' ), 'permission_callback' => $open ) );
		register_rest_route( Azl_Rest::NS, '/auth/forgot', array( 'methods' => 'POST', 'callback' => array( self::class, 'forgot' ), 'permission_callback' => $open ) );
		register_rest_route( Azl_Rest::NS, '/auth/reset', array( 'methods' => 'POST', 'callback' => array( self::class, 'reset' ), 'permission_callback' => $open ) );
		register_rest_route( Azl_Rest::NS, '/auth/logout', array( 'methods' => 'POST', 'callback' => array( self::class, 'logout' ), 'permission_callback' => 'is_user_logged_in' ) );
	}

	/* ---------- addresses ---------- */

	/** The URL of one sign-in page (login|forgot|reset). */
	public static function url( string $page, array $query = array() ): string {
		$base = get_option( 'permalink_structure' ) ? home_url( '/helpdesk/' . $page . '/' ) : add_query_arg( 'azl_auth', $page, home_url( '/' ) );
		return $query ? add_query_arg( array_map( 'rawurlencode', $query ), $base ) : $base;
	}

	/**
	 * A redirect target that is this site's /helpdesk/ or a page under it, rebuilt from this site's own
	 * origin; anything else (other hosts, //host, backslashes, dot segments, encoded tricks, the sign-in
	 * pages themselves) gives the desk.
	 */
	public static function safe_redirect( $raw ): string {
		$desk = azl_ehd_desk_url();
		if ( ! is_string( $raw ) || '' === $raw || strlen( $raw ) > 2000 || preg_match( '/[\x00-\x20\x7f\\\\]/', $raw ) ) {
			return $desk;
		}
		$p    = wp_parse_url( $raw );
		$home = wp_parse_url( home_url( '/' ) );
		if ( ! is_array( $p ) || ! is_array( $home ) || isset( $p['user'] ) || isset( $p['pass'] ) ) {
			return $desk;
		}
		if ( isset( $p['scheme'] ) || isset( $p['host'] ) || 0 === strpos( $raw, '//' ) ) {
			$same = isset( $p['scheme'], $p['host'] ) && in_array( strtolower( $p['scheme'] ), array( 'http', 'https' ), true )
				&& strtolower( $p['host'] ) === strtolower( (string) ( $home['host'] ?? '' ) )
				&& ( $p['port'] ?? null ) === ( $home['port'] ?? null );
			if ( ! $same ) {
				return $desk;
			}
		}
		$path = (string) ( $p['path'] ?? '' );
		$base = rtrim( (string) ( $home['path'] ?? '' ), '/' ) . '/helpdesk';
		if ( ! preg_match( '#^[A-Za-z0-9/_.-]*$#', $path ) || false !== strpos( $path, '..' ) || false !== strpos( $path, '//' )
			|| ( $path !== $base && 0 !== strpos( $path, $base . '/' ) ) ) {
			return $desk;
		}
		$rest = trim( substr( $path, strlen( $base ) ), '/' );
		if ( in_array( strtok( $rest, '/' ), self::PAGES, true ) ) {
			return $desk;
		}
		$query = isset( $p['query'] ) && preg_match( '/^[A-Za-z0-9=&%._~-]{1,500}$/', $p['query'] ) ? '?' . $p['query'] : '';
		$port  = isset( $home['port'] ) ? ':' . (int) $home['port'] : '';
		return strtolower( (string) $home['scheme'] ) . '://' . $home['host'] . $port . $path . $query;
	}

	/** The client's address: REMOTE_ADDR, or the proxy's X-Forwarded-For entry when the owner trusts the proxy. */
	public static function client_ip(): string {
		$ip = (string) ( $_SERVER['REMOTE_ADDR'] ?? '' ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		if ( get_option( 'azl_trust_proxy_headers', false ) && ! empty( $_SERVER['HTTP_X_FORWARDED_FOR'] ) ) {
			$hops = array_reverse( array_map( 'trim', explode( ',', (string) $_SERVER['HTTP_X_FORWARDED_FOR'] ) ) ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
			foreach ( $hops as $hop ) {
				if ( filter_var( $hop, FILTER_VALIDATE_IP ) ) {
					return $hop;
				}
			}
		}
		return filter_var( $ip, FILTER_VALIDATE_IP ) ? $ip : '0.0.0.0';
	}

	private static function agent(): string {
		return substr( (string) ( $_SERVER['HTTP_USER_AGENT'] ?? '' ), 0, 512 ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
	}

	private static function now(): int {
		return intdiv( Azl_Db::now(), 1000 );
	}

	/* ---------- CSRF ---------- */

	private static function csrf_mac( int $ts ): string {
		$client = hash( 'sha256', self::client_ip() . '|' . self::agent() );
		$key    = hash_hmac( 'sha256', 'azl-login-csrf-v1', Azl_Pin::secret(), true );
		return hash_hmac( 'sha256', $ts . '|' . $client, $key );
	}

	public static function csrf_token(): string {
		$ts = self::now();
		return $ts . '.' . self::csrf_mac( $ts );
	}

	public static function csrf_ok( $token ): bool {
		if ( ! is_string( $token ) || ! preg_match( '/^([0-9]{1,12})\.([0-9a-f]{64})$/', $token, $m ) ) {
			return false;
		}
		$ts  = (int) $m[1];
		$age = self::now() - $ts;
		return $age >= -60 && $age <= self::CSRF_TTL && hash_equals( self::csrf_mac( $ts ), $m[2] );
	}

	/** A browser that names its origin must name this site. */
	private static function same_origin( $request ): bool {
		$origin = $request->get_header( 'Origin' );
		if ( null === $origin || '' === $origin ) {
			return true;
		}
		$o = wp_parse_url( (string) $origin );
		$h = wp_parse_url( home_url( '/' ) );
		return is_array( $o ) && is_array( $h ) && strtolower( (string) ( $o['host'] ?? '' ) ) === strtolower( (string) ( $h['host'] ?? '' ) )
			&& strtolower( (string) ( $o['scheme'] ?? '' ) ) === strtolower( (string) ( $h['scheme'] ?? '' ) )
			&& ( $o['port'] ?? null ) === ( $h['port'] ?? null );
	}

	/* ---------- rate limits ---------- */

	/** Seconds left on a lock, or 0. */
	private static function locked_for( string $key ): int {
		$v = get_transient( $key );
		return is_array( $v ) && ( $v['until'] ?? 0 ) > self::now() ? (int) $v['until'] - self::now() : 0;
	}

	/** Counts one hit; locks for $window seconds once $max is reached. */
	private static function hit( string $key, int $max, int $window ): void {
		$v = get_transient( $key );
		$v = is_array( $v ) && ( $v['exp'] ?? 0 ) > self::now() ? $v : array( 'n' => 0, 'until' => 0, 'exp' => self::now() + $window );
		++$v['n'];
		if ( $v['n'] >= $max ) {
			$v['until'] = self::now() + $window;
			$v['exp']   = $v['until'];
		}
		set_transient( $key, $v, max( 1, $v['exp'] - self::now() ) );
	}

	private static function key( string $kind, string $value ): string {
		return 'azl_rl_' . $kind . '_' . substr( hash( 'sha256', $value ), 0, 32 );
	}

	private static function too_many( int $seconds ): WP_REST_Response {
		$minutes = max( 1, (int) ceil( $seconds / 60 ) );
		$text    = sprintf( 'Too many attempts. Try again in %d %s.', $minutes, 1 === $minutes ? 'minute' : 'minutes' );
		return self::reply( array( 'ok' => false, 'error' => $text, 'code' => 'azl_rate_limited' ), 429, array( 'Retry-After' => (string) $seconds ) );
	}

	/* ---------- accounts ---------- */

	public static function is_disabled( $user_id ): bool {
		return (bool) get_user_meta( (int) $user_id, self::DISABLED, true );
	}

	/** authenticate filter: a disabled account gets the same answer as a wrong password. */
	public static function refuse_disabled( $user ) {
		if ( $user instanceof WP_User && self::is_disabled( $user->ID ) ) {
			return new WP_Error( 'azl_failed', self::FAILED );
		}
		return $user;
	}

	/** auth_cookie_expiration: how long a desk account stays signed in. */
	public static function cookie_expiration( $length, $user_id, $remember ) {
		$user = get_userdata( (int) $user_id );
		if ( ! $user || ! Azl_Caps::locked( $user ) ) {
			return $length;
		}
		if ( ! user_can( $user, Azl_Caps::DIRECT ) ) {
			return 30 * DAY_IN_SECONDS;
		}
		return $remember ? 7 * DAY_IN_SECONDS : 12 * HOUR_IN_SECONDS;
	}

	private static function find_user( string $login ) {
		$user = false !== strpos( $login, '@' ) ? get_user_by( 'email', $login ) : false;
		return $user ? $user : get_user_by( 'login', $login );
	}

	/* ---------- REST: sign in and out ---------- */

	/** POST /auth/login {login, password, remember, csrf, redirectTo?} -> {ok:true, redirect} | 401/403/429 {ok:false, error, code}. */
	public static function login( $request ) {
		return self::guard(
			static function () use ( $request ) {
				$b = self::body( $request );
				if ( ! self::same_origin( $request ) || ! self::csrf_ok( $b['csrf'] ?? null ) ) {
					return self::reply( array( 'ok' => false, 'error' => self::EXPIRED, 'code' => 'azl_csrf' ), 403 );
				}
				$login    = is_string( $b['login'] ?? null ) ? trim( $b['login'] ) : '';
				$password = is_string( $b['password'] ?? null ) ? $b['password'] : '';
				$ip       = self::client_ip();
				$pair_key = self::key( 'pair', strtolower( $login ) . '|' . $ip );
				$ip_key   = self::key( 'ip', $ip );
				$wait     = max( self::locked_for( $ip_key ), self::locked_for( $pair_key ) );
				if ( $wait > 0 ) {
					return self::too_many( $wait );
				}

				$user = null;
				if ( '' !== $login && '' !== $password && strlen( $login ) <= 200 && strlen( $password ) <= 4096 ) {
					if ( ! self::find_user( $login ) ) {
						Azl_Pin::burn(); // an unknown account costs the same hash work as a wrong password
					}
					$user = wp_authenticate( $login, $password );
				} else {
					Azl_Pin::burn();
				}
				$ok = $user instanceof WP_User && user_can( $user, Azl_Caps::USE_DESK ) && ! self::is_disabled( $user->ID );
				if ( ! $ok ) {
					self::hit( $pair_key, self::PAIR_MAX, self::PAIR_WINDOW );
					self::hit( $ip_key, self::IP_MAX, self::IP_WINDOW );
					return self::reply( array( 'ok' => false, 'error' => self::FAILED, 'code' => 'azl_failed' ), 401 );
				}

				delete_transient( $pair_key );
				// A shared phone always keeps its session; people choose.
				$remember = ! user_can( $user, Azl_Caps::DIRECT ) || ! empty( $b['remember'] );
				wp_set_auth_cookie( $user->ID, $remember, is_ssl() );
				do_action( 'wp_login', $user->user_login, $user );
				return self::reply( array( 'ok' => true, 'redirect' => self::safe_redirect( $b['redirectTo'] ?? null ) ) );
			}
		);
	}

	/** POST /auth/logout (X-WP-Nonce) -> {ok:true, redirect}. Also ends the PIN sign-in of this account. */
	public static function logout( $request ) {
		return self::guard(
			static function () {
				Azl_Pin::sign_out( get_current_user_id() );
				wp_logout();
				return self::reply( array( 'ok' => true, 'redirect' => self::url( 'login' ) ) );
			}
		);
	}

	/* ---------- REST: forgotten password ---------- */

	/** POST /auth/forgot {email, csrf} -> always {ok:true, message: SENT} (or 403 csrf, 429). */
	public static function forgot( $request ) {
		return self::guard(
			static function () use ( $request ) {
				$b = self::body( $request );
				if ( ! self::same_origin( $request ) || ! self::csrf_ok( $b['csrf'] ?? null ) ) {
					return self::reply( array( 'ok' => false, 'error' => self::EXPIRED, 'code' => 'azl_csrf' ), 403 );
				}
				$email    = is_string( $b['email'] ?? null ) ? strtolower( trim( $b['email'] ) ) : '';
				$ip_key   = self::key( 'fip', self::client_ip() );
				$mail_key = self::key( 'fmail', $email );
				$wait     = max( self::locked_for( $ip_key ), self::locked_for( $mail_key ) );
				if ( $wait > 0 ) {
					return self::too_many( $wait );
				}
				self::hit( $ip_key, self::MAIL_MAX, self::MAIL_WINDOW );
				self::hit( $mail_key, self::MAIL_MAX, self::MAIL_WINDOW );

				$user = strlen( $email ) <= 200 && is_email( $email ) ? get_user_by( 'email', $email ) : false;
				if ( $user && user_can( $user, Azl_Caps::USE_DESK ) && ! self::is_disabled( $user->ID ) ) {
					self::send_link( $user, false );
				}
				return self::reply( array( 'ok' => true, 'message' => self::SENT ) );
			}
		);
	}

	/**
	 * Emails a link to /helpdesk/reset/. $welcome: the first "set your password" email of a new account.
	 * Returns false when the key or the mail failed (never says why to the visitor).
	 */
	public static function send_link( $user, bool $welcome ): bool {
		$key = get_password_reset_key( $user );
		if ( is_wp_error( $key ) ) {
			return false;
		}
		$name = Azl_Theme::tokens()['name'];
		$link = self::url( 'reset', array( 'key' => $key, 'login' => $user->user_login ) );
		if ( $welcome ) {
			/* translators: %s: hotel name */
			$subject = sprintf( __( '%s: your help desk account', 'azl-ehd' ), $name );
			/* translators: 1: hotel name, 2: link */
			$body = sprintf( __( "An account on the %1\$s help desk was made for you.\n\nChoose your password here (the link works once and expires in a day):\n%2\$s\n\nThen sign in at the help desk with this email address.", 'azl-ehd' ), $name, $link );
		} else {
			/* translators: %s: hotel name */
			$subject = sprintf( __( '%s: reset your help desk password', 'azl-ehd' ), $name );
			/* translators: 1: hotel name, 2: link */
			$body = sprintf( __( "Someone asked to reset the password of this %1\$s help desk account.\n\nChoose a new password here (the link works once and expires in a day):\n%2\$s\n\nIf it was not you, ignore this email; nothing changes.", 'azl-ehd' ), $name, $link );
		}
		return (bool) wp_mail( $user->user_email, $subject, $body );
	}

	/* ---------- REST: choose a new password ---------- */

	/** The problem with a new password, or null. */
	public static function password_problem( $password, string $email, string $login ): ?string {
		if ( ! is_string( $password ) || mb_strlen( $password ) < self::MIN_PASSWORD ) {
			return sprintf( 'Use at least %d characters.', self::MIN_PASSWORD );
		}
		if ( strlen( $password ) > 4096 ) {
			return 'That password is too long.';
		}
		$p = strtolower( trim( $password ) );
		if ( $p === strtolower( trim( $email ) ) || $p === strtolower( trim( $login ) ) ) {
			return 'Do not use your email address as the password.';
		}
		return null;
	}

	/** POST /auth/reset {login, key, password, csrf} -> {ok:true, message, redirect} | 400 {code: azl_expired|azl_weak} | 403 | 429. */
	public static function reset( $request ) {
		return self::guard(
			static function () use ( $request ) {
				$b = self::body( $request );
				if ( ! self::same_origin( $request ) || ! self::csrf_ok( $b['csrf'] ?? null ) ) {
					return self::reply( array( 'ok' => false, 'error' => self::EXPIRED, 'code' => 'azl_csrf' ), 403 );
				}
				$login    = is_string( $b['login'] ?? null ) ? trim( $b['login'] ) : '';
				$key      = is_string( $b['key'] ?? null ) ? $b['key'] : '';
				$password = $b['password'] ?? null;
				$problem  = self::password_problem( $password, '', $login );
				if ( null !== $problem ) {
					return self::reply( array( 'ok' => false, 'error' => $problem, 'code' => 'azl_weak' ), 400 );
				}
				$ip_key   = self::key( 'rip', self::client_ip() );
				$user_key = self::key( 'ruser', strtolower( $login ) );
				$wait     = max( self::locked_for( $ip_key ), self::locked_for( $user_key ) );
				if ( $wait > 0 ) {
					return self::too_many( $wait );
				}
				self::hit( $ip_key, self::MAIL_MAX, self::MAIL_WINDOW );
				self::hit( $user_key, self::MAIL_MAX, self::MAIL_WINDOW );

				$user = self::check_key( $key, $login );
				if ( ! $user ) {
					return self::reply( array( 'ok' => false, 'error' => self::BAD_LINK, 'code' => 'azl_expired' ), 400 );
				}
				$problem = self::password_problem( $password, (string) $user->user_email, (string) $user->user_login );
				if ( null !== $problem ) {
					return self::reply( array( 'ok' => false, 'error' => $problem, 'code' => 'azl_weak' ), 400 );
				}
				reset_password( $user, $password );
				WP_Session_Tokens::get_instance( $user->ID )->destroy_all();
				delete_transient( $user_key );
				return self::reply( array( 'ok' => true, 'message' => self::SAVED, 'redirect' => self::url( 'login' ) ) );
			}
		);
	}

	/** The user a reset key belongs to, or null when it is malformed, wrong or expired. */
	public static function check_key( $key, $login ) {
		if ( ! is_string( $key ) || ! is_string( $login ) || ! preg_match( '/^[A-Za-z0-9]{8,64}$/', $key ) || '' === $login || strlen( $login ) > 200 ) {
			return null;
		}
		$user = check_password_reset_key( $key, $login );
		return $user instanceof WP_User ? $user : null;
	}

	/* ---------- plumbing ---------- */

	private static function body( $request ): array {
		if ( strlen( (string) $request->get_body() ) > 8192 ) {
			return array();
		}
		$b = $request->get_json_params();
		return is_array( $b ) ? $b : array();
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
			error_log( 'azl-ehd auth error: ' . get_class( $e ) . ' at ' . basename( $e->getFile() ) . ':' . $e->getLine() );
			return self::reply( array( 'ok' => false, 'error' => self::ERROR ), 500 );
		}
	}

	/* ---------- response headers for every /helpdesk/ page ---------- */

	/** A fresh nonce for the inline config script and token style. */
	public static function nonce(): string {
		return rtrim( strtr( base64_encode( random_bytes( 18 ) ), '+/', '-_' ), '=' );
	}

	/** The origin of the uploads folder when it differs from the site (a CDN), else ''. */
	private static function uploads_origin(): string {
		$dir = wp_get_upload_dir();
		$u   = wp_parse_url( (string) ( $dir['baseurl'] ?? '' ) );
		$h   = wp_parse_url( home_url( '/' ) );
		if ( ! is_array( $u ) || empty( $u['host'] ) || ! preg_match( '/^[A-Za-z0-9.-]+$/', $u['host'] ) ) {
			return '';
		}
		$origin = ( 'http' === strtolower( (string) ( $u['scheme'] ?? '' ) ) ? 'http' : 'https' ) . '://' . strtolower( $u['host'] ) . ( isset( $u['port'] ) ? ':' . (int) $u['port'] : '' );
		$self   = is_array( $h ) ? strtolower( ( $h['scheme'] ?? 'https' ) . '://' . ( $h['host'] ?? '' ) ) . ( isset( $h['port'] ) ? ':' . (int) $h['port'] : '' ) : '';
		return $origin === $self ? '' : $origin;
	}

	/** @return array<string, string> */
	public static function security_headers( string $nonce ): array {
		$n   = "'nonce-" . $nonce . "'";
		$img = trim( "'self' data: " . self::uploads_origin() );
		return array(
			'Content-Security-Policy' => "default-src 'self'; script-src 'self' $n; style-src 'self' $n; font-src 'self'; img-src $img; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
			'X-Content-Type-Options'  => 'nosniff',
			'Referrer-Policy'         => 'same-origin',
			'X-Frame-Options'         => 'DENY',
			'Permissions-Policy'      => 'camera=(), microphone=(), geolocation=()',
			'Cache-Control'           => 'no-store, no-cache, must-revalidate, max-age=0, private',
			'X-Robots-Tag'            => 'noindex, nofollow',
		);
	}

	/* ---------- the pages ---------- */

	/** Serves /helpdesk/login|forgot|reset/ (template_redirect). */
	public static function serve( string $page ): void {
		$nonce = azl_ehd_page_headers();
		if ( 'login' === $page || 'forgot' === $page ) {
			if ( is_user_logged_in() ) {
				wp_safe_redirect( 'login' === $page ? self::safe_redirect( wp_unslash( $_GET['redirect_to'] ?? '' ) ) : azl_ehd_desk_url() ); // phpcs:ignore WordPress.Security.NonceVerification, WordPress.Security.ValidatedSanitizedInput
				exit;
			}
		}
		$ctx = array( 'nonce' => $nonce );
		if ( 'reset' === $page ) {
			$key   = wp_unslash( $_GET['key'] ?? '' );   // phpcs:ignore WordPress.Security.NonceVerification, WordPress.Security.ValidatedSanitizedInput
			$login = wp_unslash( $_GET['login'] ?? '' ); // phpcs:ignore WordPress.Security.NonceVerification, WordPress.Security.ValidatedSanitizedInput
			$user  = self::check_key( $key, $login );
			if ( ! $user ) {
				$page = 'expired';
			} else {
				$ctx['key']   = $key;
				$ctx['login'] = $user->user_login;
			}
		}
		if ( 'login' === $page ) {
			$ctx['redirect'] = self::safe_redirect( wp_unslash( $_GET['redirect_to'] ?? '' ) ); // phpcs:ignore WordPress.Security.NonceVerification, WordPress.Security.ValidatedSanitizedInput
		}
		status_header( 200 );
		self::render( $page, $ctx );
		exit;
	}

	/**
	 * Prints one standalone page (no theme header or footer). $page: login|forgot|reset|expired|message.
	 * For message: $ctx title, text, status-free links are built here.
	 */
	public static function render( string $page, array $ctx ): void {
		$t      = Azl_Theme::tokens();
		$nonce  = (string) $ctx['nonce'];
		$ver    = defined( 'AZL_EHD_VERSION' ) ? AZL_EHD_VERSION : '0';
		$asset  = static function ( string $file ) use ( $ver ) {
			return add_query_arg( 'ver', $ver, plugins_url( 'assets/auth/' . $file, AZL_EHD_FILE ) );
		};
		$titles = array(
			'login'   => __( 'Sign in', 'azl-ehd' ),
			'forgot'  => __( 'Reset your password', 'azl-ehd' ),
			'reset'   => __( 'Choose a new password', 'azl-ehd' ),
			'expired' => __( 'This link has expired', 'azl-ehd' ),
			'message' => (string) ( $ctx['title'] ?? '' ),
		);
		$title  = $titles[ $page ] ?? $titles['login'];
		$rest   = static function ( string $route ) {
			return esc_url( rest_url( Azl_Rest::NS . '/auth/' . $route ) );
		};
		$csrf   = self::csrf_token();
		?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="<?php echo esc_attr( $t['vars']['--azl-deep'] ); ?>">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="same-origin">
<title><?php echo esc_html( $title . ' · ' . $t['name'] ); ?></title>
<style nonce="<?php echo esc_attr( $nonce ); ?>"><?php echo Azl_Theme::css( $t ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- built from constants and esc_url_raw URLs ?></style>
<link rel="stylesheet" href="<?php echo esc_url( $asset( 'auth.css' ) ); ?>">
<script src="<?php echo esc_url( $asset( 'auth.js' ) ); ?>" defer></script>
</head>
<body class="azl-auth azl-auth--<?php echo esc_attr( $t['key'] ); ?>">
<a class="azl-skip" href="#azl-main"><?php esc_html_e( 'Skip to the form', 'azl-ehd' ); ?></a>
<div class="azl-shell">
	<header class="azl-brand">
		<div class="azl-brand__inner">
			<div class="azl-logo">
				<span class="azl-logo__mark <?php echo $t['logoTile'] ? 'azl-logo__mark--tile' : 'azl-logo__mark--plate'; ?>">
				<?php if ( '' !== $t['logoUrl'] ) : ?>
					<img src="<?php echo esc_url( $t['logoUrl'] ); ?>" alt="" width="40" height="40" decoding="async">
				<?php else : ?>
					<span class="azl-logo__letter" aria-hidden="true"><?php echo esc_html( mb_substr( $t['name'], 0, 1 ) ); ?></span>
				<?php endif; ?>
				</span>
				<span class="azl-logo__name"><?php echo esc_html( $t['name'] ); ?></span>
			</div>
			<div class="azl-brand__words">
				<p class="azl-brand__kicker"><?php esc_html_e( 'Staff help desk', 'azl-ehd' ); ?></p>
				<p class="azl-brand__line"><?php esc_html_e( 'Service requests, handled.', 'azl-ehd' ); ?></p>
				<p class="azl-brand__sub"><?php esc_html_e( 'Guest requests, work orders and safety calls for the whole team, in one calm place.', 'azl-ehd' ); ?></p>
			</div>
		</div>
	</header>
	<main class="azl-panel" id="azl-main" tabindex="-1">
		<div class="azl-panel__inner">
		<?php
		switch ( $page ) {
			case 'forgot':
				self::form_forgot( $rest( 'forgot' ), $csrf );
				break;
			case 'reset':
				self::form_reset( $rest( 'reset' ), $csrf, (string) $ctx['key'], (string) $ctx['login'] );
				break;
			case 'expired':
				?>
			<h1 class="azl-title"><?php echo esc_html( $title ); ?></h1>
			<p class="azl-lead"><?php esc_html_e( 'Password links work once and expire after a day. Ask for a new one and use the newest email.', 'azl-ehd' ); ?></p>
			<p><a class="azl-btn azl-btn--link" href="<?php echo esc_url( self::url( 'forgot' ) ); ?>"><?php esc_html_e( 'Request a new link', 'azl-ehd' ); ?></a></p>
			<p class="azl-alt"><a href="<?php echo esc_url( self::url( 'login' ) ); ?>"><?php esc_html_e( 'Back to sign in', 'azl-ehd' ); ?></a></p>
				<?php
				break;
			case 'message':
				?>
			<h1 class="azl-title"><?php echo esc_html( $title ); ?></h1>
			<p class="azl-lead"><?php echo esc_html( (string) ( $ctx['text'] ?? '' ) ); ?></p>
				<?php if ( is_user_logged_in() ) : ?>
			<p class="azl-alt"><a href="<?php echo esc_url( wp_logout_url( self::url( 'login' ) ) ); ?>"><?php esc_html_e( 'Sign in as someone else', 'azl-ehd' ); ?></a></p>
				<?php endif; ?>
				<?php
				break;
			default:
				self::form_login( $rest( 'login' ), $csrf, (string) ( $ctx['redirect'] ?? azl_ehd_desk_url() ) );
		}
		?>
		</div>
		<footer class="azl-foot">
			<p><?php esc_html_e( 'Having trouble? Ask your hotel owner or manager.', 'azl-ehd' ); ?></p>
			<p class="azl-foot__name"><?php echo esc_html( $t['name'] ); ?></p>
		</footer>
	</main>
</div>
</body>
</html>
		<?php
	}

	private static function alert(): void {
		echo '<div class="azl-alert" data-azl-msg role="status" aria-live="polite" aria-atomic="true"></div>';
		echo '<noscript><p class="azl-alert azl-alert--error azl-alert--static">' . esc_html__( 'Turn on JavaScript in this browser to continue.', 'azl-ehd' ) . '</p></noscript>';
	}

	private static function button( string $label, string $busy ): void {
		printf(
			'<button type="submit" class="azl-btn" data-busy-label="%2$s"><span class="azl-btn__spin" aria-hidden="true"></span><span class="azl-btn__label">%1$s</span></button>',
			esc_html( $label ),
			esc_attr( $busy )
		);
	}

	private static function password_field( string $id, string $name, string $label, string $autocomplete, string $hint = '' ): void {
		?>
			<div class="azl-field">
				<label for="<?php echo esc_attr( $id ); ?>"><?php echo esc_html( $label ); ?></label>
				<?php if ( '' !== $hint ) : ?>
				<p class="azl-hint" id="<?php echo esc_attr( $id ); ?>-hint"><?php echo esc_html( $hint ); ?></p>
				<?php endif; ?>
				<div class="azl-pass">
					<input id="<?php echo esc_attr( $id ); ?>" name="<?php echo esc_attr( $name ); ?>" type="password" autocomplete="<?php echo esc_attr( $autocomplete ); ?>" autocapitalize="none" autocorrect="off" spellcheck="false" required maxlength="4096"<?php echo '' !== $hint ? ' aria-describedby="' . esc_attr( $id ) . '-hint"' : ''; ?>>
					<button type="button" class="azl-reveal" data-azl-reveal aria-controls="<?php echo esc_attr( $id ); ?>" aria-pressed="false"><span data-azl-reveal-label><?php esc_html_e( 'Show', 'azl-ehd' ); ?></span><span class="azl-sr"> <?php esc_html_e( 'password', 'azl-ehd' ); ?></span></button>
				</div>
			</div>
		<?php
	}

	private static function form_login( string $endpoint, string $csrf, string $redirect ): void {
		?>
			<h1 class="azl-title"><?php esc_html_e( 'Sign in', 'azl-ehd' ); ?></h1>
			<p class="azl-lead"><?php esc_html_e( 'Use the email and password your hotel set up for you.', 'azl-ehd' ); ?></p>
			<form class="azl-form" data-azl-form="login" data-endpoint="<?php echo esc_url( $endpoint ); ?>" data-desk="<?php echo esc_url( azl_ehd_desk_url() ); ?>" novalidate>
				<input type="hidden" name="csrf" value="<?php echo esc_attr( $csrf ); ?>">
				<input type="hidden" name="redirectTo" value="<?php echo esc_url( $redirect ); ?>">
				<div class="azl-field">
					<label for="azl-login"><?php esc_html_e( 'Email or username', 'azl-ehd' ); ?></label>
					<input id="azl-login" name="login" type="text" inputmode="email" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required maxlength="200">
				</div>
				<?php self::password_field( 'azl-password', 'password', __( 'Password', 'azl-ehd' ), 'current-password' ); ?>
				<label class="azl-check"><input type="checkbox" name="remember" value="1"><span><?php esc_html_e( 'Keep me signed in on this device', 'azl-ehd' ); ?></span></label>
				<?php self::button( __( 'Sign in', 'azl-ehd' ), __( 'Signing in…', 'azl-ehd' ) ); ?>
				<?php self::alert(); ?>
				<p class="azl-alt"><a href="<?php echo esc_url( self::url( 'forgot' ) ); ?>"><?php esc_html_e( 'Forgot password?', 'azl-ehd' ); ?></a></p>
			</form>
		<?php
	}

	private static function form_forgot( string $endpoint, string $csrf ): void {
		?>
			<h1 class="azl-title"><?php esc_html_e( 'Reset your password', 'azl-ehd' ); ?></h1>
			<p class="azl-lead"><?php esc_html_e( 'Enter the email of your help desk account. We will send a link to choose a new password.', 'azl-ehd' ); ?></p>
			<form class="azl-form" data-azl-form="forgot" data-endpoint="<?php echo esc_url( $endpoint ); ?>" novalidate>
				<input type="hidden" name="csrf" value="<?php echo esc_attr( $csrf ); ?>">
				<div class="azl-field">
					<label for="azl-email"><?php esc_html_e( 'Email', 'azl-ehd' ); ?></label>
					<input id="azl-email" name="email" type="email" inputmode="email" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required maxlength="200">
				</div>
				<?php self::button( __( 'Send the link', 'azl-ehd' ), __( 'Sending…', 'azl-ehd' ) ); ?>
				<?php self::alert(); ?>
				<p class="azl-alt"><a href="<?php echo esc_url( self::url( 'login' ) ); ?>"><?php esc_html_e( 'Back to sign in', 'azl-ehd' ); ?></a></p>
			</form>
		<?php
	}

	private static function form_reset( string $endpoint, string $csrf, string $key, string $login ): void {
		/* translators: %d: minimum number of characters */
		$hint = sprintf( __( 'At least %d characters. Not your email address.', 'azl-ehd' ), self::MIN_PASSWORD );
		?>
			<div data-azl-step>
			<h1 class="azl-title"><?php esc_html_e( 'Choose a new password', 'azl-ehd' ); ?></h1>
			<p class="azl-lead"><?php esc_html_e( 'You will use it to sign in to the help desk.', 'azl-ehd' ); ?></p>
			<form class="azl-form" data-azl-form="reset" data-endpoint="<?php echo esc_url( $endpoint ); ?>" data-min="<?php echo (int) self::MIN_PASSWORD; ?>" data-login="<?php echo esc_attr( $login ); ?>" novalidate>
				<input type="hidden" name="csrf" value="<?php echo esc_attr( $csrf ); ?>">
				<input type="hidden" name="key" value="<?php echo esc_attr( $key ); ?>">
				<input class="azl-sr" type="text" name="login" value="<?php echo esc_attr( $login ); ?>" autocomplete="username" readonly tabindex="-1" aria-hidden="true">
				<?php self::password_field( 'azl-new', 'password', __( 'New password', 'azl-ehd' ), 'new-password', $hint ); ?>
				<?php self::password_field( 'azl-again', 'again', __( 'Type it again', 'azl-ehd' ), 'new-password' ); ?>
				<?php self::button( __( 'Save password', 'azl-ehd' ), __( 'Saving…', 'azl-ehd' ) ); ?>
				<?php self::alert(); ?>
			</form>
			</div>
			<div data-azl-done hidden>
				<h1 class="azl-title" tabindex="-1"><?php esc_html_e( 'Password saved', 'azl-ehd' ); ?></h1>
				<p class="azl-lead"><?php echo esc_html( self::SAVED ); ?></p>
				<p><a class="azl-btn azl-btn--link" href="<?php echo esc_url( self::url( 'login' ) ); ?>"><?php esc_html_e( 'Sign in', 'azl-ehd' ); ?></a></p>
			</div>
		<?php
	}
}
