<?php
/**
 * Plugin Name:       Azalea e-Helpdesk
 * Description:       Live service-request, maintenance and safety desk for one hotel property, served at /helpdesk/.
 * Version:           0.1.1
 * Requires at least: 6.4
 * Requires PHP:      8.1
 * Author:            Online Creative Solutions
 * Text Domain:       azl-ehd
 * License:           Proprietary
 *
 * One install is one property. The REST API lives in includes/ (namespace azl-ehd/v1); this file only loads it,
 * handles activation, and serves the desk shell at /helpdesk/.
 *
 * @package AzaleaEHelpdesk
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'AZL_EHD_VERSION', '0.1.1' );
define( 'AZL_EHD_FILE', __FILE__ );
define( 'AZL_EHD_DIR', plugin_dir_path( __FILE__ ) );
/** Bump when the rewrite rule changes, so it is flushed once after an update (never on every request). */
define( 'AZL_EHD_REWRITE_VERSION', '1' );

/**
 * Load every includes/*.php. A missing or broken file is reported in wp-admin instead of taking the site down.
 */
function azl_ehd_load_includes() {
	static $loaded = false;
	if ( $loaded ) {
		return;
	}
	$loaded = true;
	$files  = glob( AZL_EHD_DIR . 'includes/*.php' );
	if ( ! is_array( $files ) ) {
		return;
	}
	sort( $files );
	foreach ( $files as $file ) {
		if ( ! is_readable( $file ) ) {
			continue;
		}
		try {
			require_once $file;
		} catch ( \Throwable $e ) {
			$GLOBALS['azl_ehd_load_errors'][] = basename( $file ) . ': ' . $e->getMessage();
		}
	}
}
azl_ehd_load_includes();

add_action(
	'admin_notices',
	static function () {
		if ( empty( $GLOBALS['azl_ehd_load_errors'] ) || ! current_user_can( 'activate_plugins' ) ) {
			return;
		}
		echo '<div class="notice notice-error"><p><strong>' . esc_html__( 'Azalea e-Helpdesk could not load a file:', 'azl-ehd' ) . '</strong></p><ul>';
		foreach ( (array) $GLOBALS['azl_ehd_load_errors'] as $msg ) {
			echo '<li>' . esc_html( $msg ) . '</li>';
		}
		echo '</ul></div>';
	}
);

/* ---------- activation ---------- */

/**
 * Create or upgrade tables and capabilities, register the /helpdesk/ rule and flush rewrite rules once.
 */
function azl_ehd_activate() {
	azl_ehd_load_includes();
	if ( class_exists( 'Azl_Schema' ) && method_exists( 'Azl_Schema', 'install' ) ) {
		Azl_Schema::install();
	}
	if ( class_exists( 'Azl_Caps' ) && method_exists( 'Azl_Caps', 'install' ) ) {
		Azl_Caps::install();
	}
	azl_ehd_add_rewrite();
	flush_rewrite_rules( false );
	update_option( 'azl_ehd_rewrite_version', AZL_EHD_REWRITE_VERSION, false );
}
register_activation_hook( __FILE__, 'azl_ehd_activate' );

/**
 * Remove the /helpdesk/ rule. Data, options and capabilities stay (see uninstall.php).
 */
function azl_ehd_deactivate() {
	global $wp_rewrite;
	if ( isset( $wp_rewrite->extra_rules_top ) && is_array( $wp_rewrite->extra_rules_top ) ) {
		unset( $wp_rewrite->extra_rules_top[ azl_ehd_rewrite_regex() ] );
	}
	flush_rewrite_rules( false );
	delete_option( 'azl_ehd_rewrite_version' );
}
register_deactivation_hook( __FILE__, 'azl_ehd_deactivate' );

/* ---------- REST ---------- */

add_action(
	'rest_api_init',
	static function () {
		if ( class_exists( 'Azl_Rest' ) && method_exists( 'Azl_Rest', 'register_routes' ) ) {
			Azl_Rest::register_routes();
		}
	}
);

/* ---------- the /helpdesk/ route ---------- */

/**
 * The rewrite pattern for /helpdesk/.
 *
 * @return string
 */
function azl_ehd_rewrite_regex() {
	return '^helpdesk/?$';
}

/**
 * Register the rule and its query var. Runs on every init (cheap); flushing does not.
 */
function azl_ehd_add_rewrite() {
	add_rewrite_rule( azl_ehd_rewrite_regex(), 'index.php?azl_helpdesk=1', 'top' );
}
add_action( 'init', 'azl_ehd_add_rewrite' );

add_action(
	'admin_init',
	static function () {
		// After a plugin update that changed the rule: flush once, then never again until the next change.
		if ( get_option( 'azl_ehd_rewrite_version' ) !== AZL_EHD_REWRITE_VERSION && current_user_can( 'activate_plugins' ) ) {
			flush_rewrite_rules( false );
			update_option( 'azl_ehd_rewrite_version', AZL_EHD_REWRITE_VERSION, false );
		}
	}
);

add_filter(
	'query_vars',
	static function ( $vars ) {
		$vars[] = 'azl_helpdesk';
		return $vars;
	}
);

/**
 * The public URL of the desk.
 *
 * @return string
 */
function azl_ehd_desk_url() {
	return get_option( 'permalink_structure' ) ? home_url( '/helpdesk/' ) : add_query_arg( 'azl_helpdesk', '1', home_url( '/' ) );
}

/**
 * The built desk files from assets/desk/manifest.json (written by `npm run build:wp`).
 *
 * @return array{js: string, css: string[]}|null Null when the build is missing.
 */
function azl_ehd_assets() {
	$path = AZL_EHD_DIR . 'assets/desk/manifest.json';
	if ( ! is_readable( $path ) ) {
		return null;
	}
	$manifest = json_decode( (string) file_get_contents( $path ), true ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
	if ( ! is_array( $manifest ) ) {
		return null;
	}
	$entry = $manifest['src/wp/main.tsx'] ?? null;
	if ( ! is_array( $entry ) ) {
		foreach ( $manifest as $chunk ) {
			if ( is_array( $chunk ) && ! empty( $chunk['isEntry'] ) ) {
				$entry = $chunk;
				break;
			}
		}
	}
	$safe = static function ( $file ) {
		return is_string( $file ) && preg_match( '/^[A-Za-z0-9._-]+$/', $file ) ? $file : null;
	};
	$js = is_array( $entry ) ? $safe( $entry['file'] ?? null ) : null;
	if ( ! $js ) {
		return null;
	}
	$base = plugins_url( 'assets/desk/', AZL_EHD_FILE );
	$css  = array();
	foreach ( (array) ( $entry['css'] ?? array() ) as $file ) {
		if ( $safe( $file ) ) {
			$css[] = $base . $file;
		}
	}
	return array(
		'js'  => $base . $js,
		'css' => $css,
	);
}

/**
 * The desk role shown in the app, from the WordPress user's roles and capabilities.
 *
 * @param WP_User $user The signed-in user.
 * @return string owner|manager|supervisor|device
 */
function azl_ehd_desk_role( $user ) {
	// Without azl_act_directly (shared phones, unknown roles) every action needs a staff PIN: the same rule as the REST API.
	if ( ! user_can( $user, 'azl_act_directly' ) ) {
		return 'device';
	}
	if ( in_array( 'administrator', (array) $user->roles, true ) ) {
		return 'owner';
	}
	return user_can( $user, 'azl_manage_staff' ) ? 'manager' : 'supervisor';
}

/**
 * Send the no-cache headers every desk response needs, and tell page-cache plugins to skip it.
 */
function azl_ehd_no_cache() {
	if ( ! defined( 'DONOTCACHEPAGE' ) ) {
		define( 'DONOTCACHEPAGE', true );
	}
	if ( ! defined( 'DONOTCACHEOBJECT' ) ) {
		define( 'DONOTCACHEOBJECT', true );
	}
	if ( ! defined( 'DONOTCACHEDB' ) ) {
		define( 'DONOTCACHEDB', true );
	}
	nocache_headers();
	header( 'Cache-Control: no-store, no-cache, must-revalidate, max-age=0, private' );
	header( 'X-Robots-Tag: noindex, nofollow' );
	header( 'Referrer-Policy: same-origin' );
	header( 'X-Content-Type-Options: nosniff' );
	header( 'Content-Type: text/html; charset=utf-8' );
}

/**
 * A small page with no theme, for the 403 and "not built" cases.
 *
 * @param int    $status HTTP status.
 * @param string $title  Heading.
 * @param string $body   Plain text message.
 */
function azl_ehd_plain_page( $status, $title, $body ) {
	status_header( $status );
	azl_ehd_no_cache();
	?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title><?php echo esc_html( $title ); ?></title>
<style>body{font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:#f2f2f7;color:#1c1c1e;margin:0;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}main{max-width:440px;background:#fff;border-radius:16px;padding:24px}a{color:#0a63c9}</style>
</head>
<body>
<main>
<h1><?php echo esc_html( $title ); ?></h1>
<p><?php echo esc_html( $body ); ?></p>
<p><a href="<?php echo esc_url( home_url( '/' ) ); ?>"><?php esc_html_e( 'Back to the website', 'azl-ehd' ); ?></a> &middot; <a href="<?php echo esc_url( wp_logout_url( azl_ehd_desk_url() ) ); ?>"><?php esc_html_e( 'Sign in as someone else', 'azl-ehd' ); ?></a></p>
</main>
</body>
</html>
	<?php
	exit;
}

/**
 * Serve /helpdesk/: only the app shell, never the theme header or footer.
 */
function azl_ehd_render_desk() {
	if ( ! get_query_var( 'azl_helpdesk' ) ) {
		return;
	}
	azl_ehd_no_cache();

	if ( ! is_user_logged_in() ) {
		wp_safe_redirect( wp_login_url( azl_ehd_desk_url() ) );
		exit;
	}
	if ( ! current_user_can( 'azl_use_desk' ) ) {
		azl_ehd_plain_page(
			403,
			__( 'No access to the help desk', 'azl-ehd' ),
			__( 'You are signed in, but this account is not allowed to open the help desk. Ask a manager to give your account a help desk role.', 'azl-ehd' )
		);
	}
	$assets = azl_ehd_assets();
	if ( ! $assets ) {
		azl_ehd_plain_page( 503, __( 'Help desk not built', 'azl-ehd' ), __( 'The desk files are missing from this plugin. Reinstall the plugin zip.', 'azl-ehd' ) );
	}

	$user     = wp_get_current_user();
	$settings = class_exists( 'Azl_Admin' ) ? Azl_Admin::settings() : array();
	$config   = array(
		'restUrl'  => esc_url_raw( rest_url( 'azl-ehd/v1/' ) ),
		'nonce'    => wp_create_nonce( 'wp_rest' ),
		'loginUrl' => esc_url_raw( wp_login_url( azl_ehd_desk_url() ) ),
		'accountUrl' => esc_url_raw( admin_url( 'profile.php' ) ),
		'pollMs'   => 1000 * (int) ( $settings['poll_seconds'] ?? 5 ),
		'property' => array(
			'id'   => (string) get_current_blog_id(),
			'name' => (string) ( $settings['property_name'] ?? get_bloginfo( 'name' ) ),
		),
		'user'     => array(
			'name'      => (string) $user->display_name,
			'role'      => azl_ehd_desk_role( $user ),
			'canManage' => current_user_can( 'azl_manage_staff' ),
		),
		'version'  => AZL_EHD_VERSION,
	);
	$json = wp_json_encode( $config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT );

	status_header( 200 );
	?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f2f2f7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex, nofollow">
<title><?php echo esc_html( sprintf( /* translators: %s: property name */ __( 'E-Help Desk · %s', 'azl-ehd' ), $config['property']['name'] ) ); ?></title>
	<?php foreach ( $assets['css'] as $href ) : ?>
<link rel="stylesheet" href="<?php echo esc_url( $href ); ?>">
	<?php endforeach; ?>
</head>
<body>
<div id="azl-root"></div>
	<?php
	// phpcs:disable WordPress.Security.EscapeOutput.OutputNotEscaped -- wp_get_*_tag escape their attributes; $json is wp_json_encode with JSON_HEX_* flags.
	echo wp_get_inline_script_tag( 'window.AZL = ' . $json . ';' );
	echo wp_get_script_tag(
		array(
			'type' => 'module',
			'src'  => esc_url( $assets['js'] ),
		)
	);
	// phpcs:enable
	?>
</body>
</html>
	<?php
	exit;
}
add_action( 'template_redirect', 'azl_ehd_render_desk', 0 );
