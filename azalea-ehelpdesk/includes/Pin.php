<?php
/**
 * Port of src/server/pin.ts and actor.ts: PIN hashing and the signed "acting staff" token.
 *
 * - A PIN is 4 digits. It is stored with password_hash() over an HMAC of the PIN keyed by the site
 *   secret (a pepper), so a copy of the database alone cannot be brute-forced over 10,000 values.
 * - The site secret is the option azl_secret, made with random_bytes() on first use, never autoloaded,
 *   never sent to the browser. Changing it signs every staff member out and voids every PIN.
 * - After a correct PIN the server hands out a token naming the staff member, bound to the WordPress
 *   user that asked, valid 12 hours. The browser can present it but cannot make or change one.
 *
 * @package azl-ehd
 */

defined( 'ABSPATH' ) || exit;

final class Azl_Pin {

	const SECRET_OPTION = 'azl_secret';
	const SIGNED_OUT    = 'azl_actor_signed_out';
	const TOKEN_HOURS   = 12;

	public static function valid( $pin ): bool {
		return is_string( $pin ) && 1 === preg_match( '/^[0-9]{4}\z/', $pin );
	}

	/** True when the PIN is easy to guess: one repeated digit, or a straight run like 1234 or 4321. */
	public static function is_weak( $pin ): bool {
		if ( ! self::valid( $pin ) ) {
			return true;
		}
		$d = array_map( 'intval', str_split( $pin ) );
		if ( count( array_unique( $d ) ) === 1 ) {
			return true;
		}
		$step = $d[1] - $d[0];
		if ( abs( $step ) !== 1 ) {
			return false;
		}
		for ( $i = 2; $i < 4; $i++ ) {
			if ( $d[ $i ] - $d[ $i - 1 ] !== $step ) {
				return false;
			}
		}
		return true;
	}

	public static function hash( string $pin ): string {
		return password_hash( self::pepper( $pin ), PASSWORD_DEFAULT );
	}

	public static function verify( $pin, ?string $hash ): bool {
		if ( ! self::valid( $pin ) || ! is_string( $hash ) || '' === $hash ) {
			return false;
		}
		return password_verify( self::pepper( $pin ), $hash );
	}

	/** Spends the same time as a real check, so an unknown or locked person answers as slowly as a wrong PIN. */
	public static function burn(): void {
		static $dummy = null;
		if ( null === $dummy ) {
			$dummy = password_hash( 'azl-dummy', PASSWORD_DEFAULT );
		}
		password_verify( 'azl-not-it', $dummy );
	}

	/* ---------- site secret ---------- */

	public static function secret(): string {
		$s = get_option( self::SECRET_OPTION );
		if ( is_string( $s ) && strlen( $s ) >= 64 ) {
			return $s;
		}
		$new = bin2hex( random_bytes( 32 ) );
		// add_option() fails when another request made it first; then use theirs.
		if ( ! add_option( self::SECRET_OPTION, $new, '', false ) ) {
			$s = get_option( self::SECRET_OPTION );
			if ( is_string( $s ) && strlen( $s ) >= 64 ) {
				return $s;
			}
			update_option( self::SECRET_OPTION, $new, false );
		}
		return $new;
	}

	private static function key( string $purpose ): string {
		return hash_hmac( 'sha256', $purpose, self::secret(), true );
	}

	private static function pepper( string $pin ): string {
		return base64_encode( hash_hmac( 'sha256', $pin, self::key( 'azl-pin-pepper-v1' ), true ) );
	}

	/* ---------- acting-staff token ---------- */

	private static function b64( string $raw ): string {
		return rtrim( strtr( base64_encode( $raw ), '+/', '-_' ), '=' );
	}

	private static function unb64( string $s ) {
		return base64_decode( strtr( $s, '-_', '+/' ), true );
	}

	private static function mac( string $body ): string {
		return self::b64( hash_hmac( 'sha256', $body, self::key( 'azl-actor-v1' ), true ) );
	}

	/** @return array{token: string, expiresAt: int} */
	public static function sign_actor( int $user_id, string $staff_id ): array {
		$now  = Azl_Db::now();
		$exp  = $now + self::TOKEN_HOURS * 3600 * 1000;
		$body = self::b64( (string) wp_json_encode( array( 'u' => $user_id, 's' => $staff_id, 'iat' => $now, 'exp' => $exp ) ) );
		return array( 'token' => $body . '.' . self::mac( $body ), 'expiresAt' => $exp );
	}

	/** The staff id in a token, or null when it is missing, forged, expired, signed out or for another user. */
	public static function read_actor( $token, int $user_id ): ?string {
		if ( ! is_string( $token ) || $user_id <= 0 || strlen( $token ) > 1024 ) {
			return null;
		}
		$parts = explode( '.', $token );
		if ( count( $parts ) !== 2 || '' === $parts[0] || '' === $parts[1] ) {
			return null;
		}
		if ( ! hash_equals( self::mac( $parts[0] ), $parts[1] ) ) {
			return null;
		}
		$json = self::unb64( $parts[0] );
		$a    = false === $json ? null : json_decode( $json, true );
		if ( ! is_array( $a ) || ( $a['u'] ?? null ) !== $user_id || ! Azl_Db::is_uuid( $a['s'] ?? null )
			|| ! is_int( $a['exp'] ?? null ) || ! is_int( $a['iat'] ?? null ) || $a['exp'] <= Azl_Db::now() ) {
			return null;
		}
		$out = (int) get_user_meta( $user_id, self::SIGNED_OUT, true );
		if ( $a['iat'] <= $out ) {
			return null;
		}
		return strtolower( $a['s'] );
	}

	/** Voids every token this WordPress user holds (the shared phone hands back to "pick your name"). */
	public static function sign_out( int $user_id ): void {
		update_user_meta( $user_id, self::SIGNED_OUT, Azl_Db::now() );
	}
}
