<?php
/**
 * The hotel profile shown on the Configuration page: name, short name, contact and address, in the existing settings
 * option azl_settings (keys property_name, property_short, property_contact, property_address). property_name stays the
 * one name every page prints (window.AZL.property.name, the snapshot, the sign-in pages), so the wp-admin Settings page
 * and the desk edit the same value. The time zone is fixed: Asia/Manila (every module's dates use it).
 *
 * GET /profile for every desk role; PUT /profile for the hotel owner and administrators (Azl_Rest::can_manage_profile).
 *
 * @package azl-ehd
 */

defined( 'ABSPATH' ) || exit;

final class Azl_Profile {

	const TIME_ZONE = 'Asia/Manila';

	/** Field => [settings key, max length, required, label for messages]. */
	const FIELDS = array(
		'name'    => array( 'property_name', 80, true, 'hotel name' ),
		'short'   => array( 'property_short', 20, false, 'short name' ),
		'contact' => array( 'property_contact', 120, false, 'contact' ),
		'address' => array( 'property_address', 200, false, 'address' ),
	);

	/** The profile: {name, short, contact, address, timeZone}. The name falls back to the site name, like Azl_Admin. */
	public static function get(): array {
		$s   = get_option( 'azl_settings', array() );
		$s   = is_array( $s ) ? $s : array();
		$out = array();
		foreach ( self::FIELDS as $field => list( $key ) ) {
			$out[ $field ] = is_string( $s[ $key ] ?? null ) ? $s[ $key ] : '';
		}
		if ( '' === trim( $out['name'] ) ) {
			$out['name'] = wp_specialchars_decode( (string) get_bloginfo( 'name' ), ENT_QUOTES );
		}
		return $out + array( 'timeZone' => self::TIME_ZONE );
	}

	/**
	 * Saves the profile. Every field is sent; texts are one line, trimmed, within their lengths; the name is required.
	 * Other settings (rooms, look, refresh, uninstall) are kept.
	 *
	 * @return array{ok: bool, error?: string, field?: string, profile?: array}
	 */
	public static function save( $in ): array {
		if ( ! is_array( $in ) ) {
			return array( 'ok' => false, 'error' => 'Send the profile as JSON.' );
		}
		$set = array();
		foreach ( self::FIELDS as $field => list( $key, $max, $required, $what ) ) {
			$v = $in[ $field ] ?? '';
			if ( ! is_string( $v ) ) {
				return array( 'ok' => false, 'field' => $field, 'error' => "Enter the $what as text." );
			}
			$v = trim( sanitize_text_field( $v ) );
			if ( $required && '' === $v ) {
				return array( 'ok' => false, 'field' => $field, 'error' => "Enter the $what." );
			}
			if ( mb_strlen( $v ) > $max ) {
				return array( 'ok' => false, 'field' => $field, 'error' => "Keep the $what to $max characters." );
			}
			$set[ $key ] = $v;
		}
		$s = get_option( 'azl_settings', array() );
		update_option( 'azl_settings', array_merge( is_array( $s ) ? $s : array(), $set ) );
		Azl_Db::bump( 'change' ); // phones pick up the new name on their next poll
		return array( 'ok' => true, 'profile' => self::get() );
	}

	/** GET /profile -> {ok:true, profile}. */
	public static function rest_get( $request ) {
		$r = new WP_REST_Response( array( 'ok' => true, 'profile' => self::get() ), 200 );
		$r->header( 'Cache-Control', 'no-store, max-age=0' );
		return $r;
	}

	/** PUT /profile {name, short, contact, address} -> 200 {ok:true, profile} or 400 {ok:false, error, field}. */
	public static function rest_put( $request ) {
		try {
			$raw = (string) $request->get_body();
			$b   = strlen( $raw ) > Azl_Rest::MAX_BODY ? null : $request->get_json_params();
			$out = self::save( is_array( $b ) && ! array_is_list( $b ) ? $b : null );
			$r   = new WP_REST_Response( $out, $out['ok'] ? 200 : 400 );
		} catch ( Throwable $e ) {
			error_log( 'azl-ehd REST error: ' . $e->getMessage() );
			$r = new WP_REST_Response( array( 'ok' => false, 'error' => Azl_Commands::ERROR ), 500 );
		}
		$r->header( 'Cache-Control', 'no-store, max-age=0' );
		return $r;
	}
}
