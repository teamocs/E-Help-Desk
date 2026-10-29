<?php
/**
 * The hotel's look: design tokens as CSS custom properties, shared by the desk and the sign-in pages.
 * Light theme only. The desk restyle depends on these exact variable names.
 *
 * The preset comes from the setting property_key ('baguio' or 'boracay'); unset, it is guessed from
 * home_url(), and Baguio is the default. Fonts are bundled in assets/fonts/ (SIL OFL): no external
 * font request is ever made.
 *
 * @package azl-ehd
 */

defined( 'ABSPATH' ) || exit;

final class Azl_Theme {

	const KEYS = array( 'baguio', 'boracay' );

	/** Status colours, the same on both sites (WCAG AA on their soft grounds; tested). */
	const STATUS = array(
		'--azl-ok'        => '#2b6b45',
		'--azl-ok-soft'   => '#e3f1e8',
		'--azl-warn'      => '#7a4b00',
		'--azl-warn-soft' => '#fbefd0',
		'--azl-bad'       => '#a43d36',
		'--azl-bad-soft'  => '#f8e3e1',
	);

	const SHARED = array(
		'--azl-font-heading' => '"Amaranth", Georgia, "Times New Roman", serif',
		'--azl-font-body'    => '"Figtree", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
		'--azl-radius-pill'  => '999px',
		'--azl-radius-card'  => '16px',
		'--azl-radius-input' => '8px',
	);

	const PRESETS = array(
		// Azalea Baguio, "Pine & Lamplight". Never teal or blue here. Gold takes ink text, never white.
		'baguio'  => array(
			'--azl-bg'            => '#f6f2e9',
			'--azl-surface'       => '#ffffff',
			'--azl-ink'           => '#201e1d',
			'--azl-muted'         => '#6d675f',
			'--azl-line'          => 'rgba(32, 30, 29, 0.14)',
			'--azl-accent'        => '#3f7052',
			'--azl-accent-strong' => '#345f45',
			'--azl-accent-soft'   => '#e6eee8',
			'--azl-on-accent'     => '#ffffff',
			'--azl-deep'          => '#142d1f',
			'--azl-on-deep'       => '#cfd8d0',
			'--azl-gold'          => '#c0a14c',
			'--azl-on-gold'       => '#201e1d',
			'--azl-shadow'        => '0 6px 24px rgba(32, 30, 29, 0.12)',
		),
		// Azalea Boracay. --azl-gold carries the secondary sand here.
		'boracay' => array(
			'--azl-bg'            => '#f7f4ec',
			'--azl-surface'       => '#ffffff',
			'--azl-ink'           => '#201e1d',
			'--azl-muted'         => '#6d675f',
			'--azl-line'          => 'rgba(32, 30, 29, 0.14)',
			'--azl-accent'        => '#177280',
			'--azl-accent-strong' => '#135f6b',
			'--azl-accent-soft'   => '#e2f2f5',
			'--azl-on-accent'     => '#ffffff',
			'--azl-deep'          => '#0e393f',
			'--azl-on-deep'       => '#e2f2f5',
			'--azl-gold'          => '#d8d2c4',
			'--azl-on-gold'       => '#201e1d',
			'--azl-shadow'        => '0 6px 24px rgba(14, 57, 63, 0.12)',
		),
	);

	/** Every variable name, in the order they are printed. */
	public static function names(): array {
		return array_keys( self::vars( 'baguio' ) );
	}

	/** The full variable map for one preset. */
	public static function vars( string $key ): array {
		return self::PRESETS[ $key ] + self::STATUS + self::SHARED;
	}

	/** baguio|boracay: the setting, else a guess from the site address, else baguio. */
	public static function key(): string {
		$settings = class_exists( 'Azl_Admin' ) ? Azl_Admin::settings() : get_option( 'azl_settings', array() );
		$key      = is_array( $settings ) ? (string) ( $settings['property_key'] ?? '' ) : '';
		if ( in_array( $key, self::KEYS, true ) ) {
			return $key;
		}
		$home = strtolower( (string) home_url( '/' ) );
		return false !== strpos( $home, 'boracay' ) ? 'boracay' : 'baguio';
	}

	/**
	 * The active hotel's design.
	 *
	 * @return array{key: string, name: string, logoUrl: string, logoTile: bool, fonts: array{heading: string, body: string}, vars: array<string, string>}
	 */
	public static function tokens(): array {
		$key      = self::key();
		$settings = class_exists( 'Azl_Admin' ) ? Azl_Admin::settings() : array();
		$name     = trim( (string) ( $settings['property_name'] ?? '' ) );
		if ( '' === $name ) {
			$name = wp_specialchars_decode( (string) get_bloginfo( 'name' ), ENT_QUOTES );
		}
		return array(
			'key'      => $key,
			'name'     => $name,
			'logoUrl'  => self::logo( $key ),
			// Baguio shows the site icon on a dark-green tile; Boracay's logo stands on its own.
			'logoTile' => 'baguio' === $key,
			'fonts'    => array(
				'heading' => self::SHARED['--azl-font-heading'],
				'body'    => self::SHARED['--azl-font-body'],
			),
			'vars'     => self::vars( $key ),
		);
	}

	/** The part of tokens() the desk receives as window.AZL.theme. */
	public static function public_tokens( array $t ): array {
		return array(
			'key'     => $t['key'],
			'name'    => $t['name'],
			'logoUrl' => $t['logoUrl'],
			'fonts'   => $t['fonts'],
		);
	}

	private static function logo( string $key ): string {
		if ( 'boracay' === $key ) {
			$id  = (int) get_theme_mod( 'custom_logo' );
			$url = $id > 0 ? wp_get_attachment_image_url( $id, 'medium' ) : '';
			if ( is_string( $url ) && '' !== $url ) {
				return esc_url_raw( $url );
			}
		}
		return esc_url_raw( (string) get_site_icon_url( 192 ) );
	}

	/** The fonts and the variables, as the body of one nonce'd <style>. */
	public static function css( array $t ): string {
		$font = static function ( string $file ): string {
			return esc_url_raw( plugins_url( 'assets/fonts/' . $file, AZL_EHD_FILE ) );
		};
		$css  = '@font-face{font-family:"Amaranth";font-style:normal;font-weight:400;font-display:swap;src:url("' . $font( 'amaranth-400-latin.woff2' ) . '") format("woff2")}';
		$css .= '@font-face{font-family:"Figtree";font-style:normal;font-weight:300 900;font-display:swap;src:url("' . $font( 'figtree-variable-latin.woff2' ) . '") format("woff2")}';
		$css .= ':root{color-scheme:light;';
		foreach ( $t['vars'] as $name => $value ) {
			// Values are constants above; the guard keeps a future edit from breaking out of the style tag.
			if ( preg_match( '/^--azl-[a-z-]+$/', $name ) && ! preg_match( '/[<>{};]/', $value ) ) {
				$css .= $name . ':' . $value . ';';
			}
		}
		return $css . '}';
	}

	/* ---------- contrast (WCAG 2.x), used by the tests ---------- */

	public static function luminance( string $hex ): float {
		$hex = ltrim( $hex, '#' );
		$c   = array();
		foreach ( array( 0, 2, 4 ) as $i ) {
			$v   = hexdec( substr( $hex, $i, 2 ) ) / 255;
			$c[] = $v <= 0.04045 ? $v / 12.92 : ( ( $v + 0.055 ) / 1.055 ) ** 2.4;
		}
		return 0.2126 * $c[0] + 0.7152 * $c[1] + 0.0722 * $c[2];
	}

	public static function contrast( string $fg, string $bg ): float {
		$a = self::luminance( $fg ) + 0.05;
		$b = self::luminance( $bg ) + 0.05;
		return max( $a, $b ) / min( $a, $b );
	}
}
