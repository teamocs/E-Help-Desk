<?php
/**
 * Plugin Name:       Azalea e-Helpdesk
 * Description:       Live service-request, maintenance and safety desk for one hotel property, served at /helpdesk/.
 * Version:           0.5.1
 * Requires at least: 6.4
 * Requires PHP:      8.1
 * Author:            Online Creative Solutions
 * Text Domain:       azl-ehd
 * License:           Proprietary
 *
 * One install is one property. The REST API lives in includes/ (namespace azl-ehd/v1); this file only loads it,
 * handles activation, and serves the desk shell at /helpdesk/ and the sign-in pages under it.
 *
 * @package AzaleaEHelpdesk
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'AZL_EHD_VERSION', '0.5.1' );
define( 'AZL_EHD_FILE', __FILE__ );
define( 'AZL_EHD_DIR', plugin_dir_path( __FILE__ ) );
/** Bump when the rewrite rules change, so they are flushed once after an update (never on every request). */
define( 'AZL_EHD_REWRITE_VERSION', '2' );

/**
 * Load every includes/*.php, then every module in includes/Modules/*.php (see includes/Modules.php). A missing or
 * broken file, or a module that does not register cleanly, is reported in wp-admin instead of taking the site down.
 */
function azl_ehd_load_includes() {
	static $loaded = false;
	if ( $loaded ) {
		return;
	}
	$loaded  = true;
	$files   = glob( AZL_EHD_DIR . 'includes/*.php' );
	$modules = glob( AZL_EHD_DIR . 'includes/Modules/*.php' );
	if ( ! is_array( $files ) ) {
		return;
	}
	sort( $files );
	$modules = is_array( $modules ) ? $modules : array();
	sort( $modules );
	foreach ( array_merge( $files, $modules ) as $file ) {
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

// Roles upgrade, wp-admin lockdown, session lengths and the disabled-account check.
if ( class_exists( 'Azl_Caps' ) ) {
	Azl_Caps::hooks();
}
if ( class_exists( 'Azl_Auth' ) ) {
	Azl_Auth::hooks();
}
// Tables: an update (or a new module) creates its new tables once, before anything reads them. Additive only.
if ( class_exists( 'Azl_Schema' ) ) {
	add_action( 'plugins_loaded', array( 'Azl_Schema', 'maybe_upgrade' ) );
}

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
 * Create or upgrade tables and roles, register the /helpdesk/ rules and flush rewrite rules once.
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
 * Remove the /helpdesk/ rules. Data, options and roles stay (see uninstall.php).
 */
function azl_ehd_deactivate() {
	global $wp_rewrite;
	if ( isset( $wp_rewrite->extra_rules_top ) && is_array( $wp_rewrite->extra_rules_top ) ) {
		foreach ( array_keys( azl_ehd_rewrite_rules() ) as $regex ) {
			unset( $wp_rewrite->extra_rules_top[ $regex ] );
		}
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
		if ( class_exists( 'Azl_Auth' ) ) {
			Azl_Auth::register_routes();
		}
		if ( class_exists( 'Azl_Accounts' ) ) {
			Azl_Accounts::register_routes();
		}
	}
);

/* ---------- the /helpdesk/ routes ---------- */

/**
 * The rewrite rules, in match order: the sign-in pages, the desk, then anything else under /helpdesk/
 * (azl_helpdesk=2: the sign-in page when signed out, the desk when signed in).
 *
 * @return array<string, string>
 */
function azl_ehd_rewrite_rules() {
	return array(
		'^helpdesk/(login|forgot|reset)/?$' => 'index.php?azl_auth=$matches[1]',
		'^helpdesk/?$'                      => 'index.php?azl_helpdesk=1',
		'^helpdesk/.+$'                     => 'index.php?azl_helpdesk=2',
	);
}

/**
 * Register the rules. Runs on every init (cheap); flushing does not.
 */
function azl_ehd_add_rewrite() {
	foreach ( azl_ehd_rewrite_rules() as $regex => $query ) {
		add_rewrite_rule( $regex, $query, 'top' );
	}
}
add_action( 'init', 'azl_ehd_add_rewrite' );

add_action(
	'admin_init',
	static function () {
		// After a plugin update that changed the rules: flush once, then never again until the next change.
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
		$vars[] = 'azl_auth';
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
	// Hotel owners (azl_owner) and administrators, who hold every azl_* capability.
	if ( user_can( $user, 'azl_manage_accounts' ) || in_array( 'administrator', (array) $user->roles, true ) ) {
		return 'owner';
	}
	return user_can( $user, 'azl_manage_staff' ) ? 'manager' : 'supervisor';
}

/**
 * Headers for every /helpdesk/ page (desk and sign-in pages): no caching anywhere, and the security
 * headers with a fresh CSP nonce, which the page puts on its inline config script and token style.
 *
 * @return string The CSP nonce.
 */
function azl_ehd_page_headers() {
	foreach ( array( 'DONOTCACHEPAGE', 'DONOTCACHEOBJECT', 'DONOTCACHEDB' ) as $flag ) {
		if ( ! defined( $flag ) ) {
			define( $flag, true );
		}
	}
	nocache_headers();
	$nonce = Azl_Auth::nonce();
	foreach ( Azl_Auth::security_headers( $nonce ) as $name => $value ) {
		header( $name . ': ' . $value );
	}
	header( 'Content-Type: text/html; charset=utf-8' );
	return $nonce;
}

/**
 * A small branded page with no theme, for the 403 and "not built" cases.
 *
 * @param int    $status HTTP status.
 * @param string $title  Heading.
 * @param string $body   Plain text message.
 */
function azl_ehd_plain_page( $status, $title, $body ) {
	$nonce = azl_ehd_page_headers();
	status_header( $status );
	Azl_Auth::render(
		'message',
		array(
			'nonce' => $nonce,
			'title' => $title,
			'text'  => $body,
		)
	);
	exit;
}

/**
 * The current request as an absolute URL on this site, for redirect_to (Azl_Auth::safe_redirect checks it).
 *
 * @return string
 */
function azl_ehd_current_url() {
	$home = wp_parse_url( home_url( '/' ) );
	$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '/'; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
	return ( $home['scheme'] ?? 'https' ) . '://' . ( $home['host'] ?? '' ) . ( isset( $home['port'] ) ? ':' . (int) $home['port'] : '' ) . $uri;
}

/**
 * Serve /helpdesk/ and everything under it: the sign-in pages, or the app shell. Never the theme header or footer.
 */
function azl_ehd_render_desk() {
	$auth = (string) get_query_var( 'azl_auth' );
	if ( in_array( $auth, Azl_Auth::PAGES, true ) ) {
		Azl_Auth::serve( $auth );
	}
	$desk = (string) get_query_var( 'azl_helpdesk' );
	if ( '' === $desk ) {
		return;
	}
	if ( ! is_user_logged_in() ) {
		azl_ehd_page_headers();
		wp_safe_redirect( Azl_Auth::url( 'login', array( 'redirect_to' => Azl_Auth::safe_redirect( azl_ehd_current_url() ) ) ) );
		exit;
	}
	if ( '1' !== $desk ) {
		azl_ehd_page_headers();
		wp_safe_redirect( azl_ehd_desk_url() );
		exit;
	}
	if ( ! current_user_can( 'azl_use_desk' ) || Azl_Auth::is_disabled( get_current_user_id() ) ) {
		azl_ehd_plain_page(
			403,
			__( 'No access to the help desk', 'azl-ehd' ),
			__( 'You are signed in, but this account is not allowed to open the help desk. Ask your hotel owner or manager to give your account a help desk role.', 'azl-ehd' )
		);
	}
	$assets = azl_ehd_assets();
	if ( ! $assets ) {
		azl_ehd_plain_page( 503, __( 'Help desk not built', 'azl-ehd' ), __( 'The desk files are missing from this plugin. Reinstall the plugin zip.', 'azl-ehd' ) );
	}

	$nonce    = azl_ehd_page_headers();
	$user     = wp_get_current_user();
	$settings = class_exists( 'Azl_Admin' ) ? Azl_Admin::settings() : array();
	$theme    = Azl_Theme::tokens();
	$config   = array(
		'restUrl'    => esc_url_raw( rest_url( 'azl-ehd/v1/' ) ),
		'nonce'      => wp_create_nonce( 'wp_rest' ),
		'loginUrl'   => esc_url_raw( Azl_Auth::url( 'login' ) ),
		// No wp-admin links for desk accounts: the account page is the desk itself.
		'accountUrl' => esc_url_raw( azl_ehd_desk_url() ),
		'pollMs'     => 1000 * (int) ( $settings['poll_seconds'] ?? 5 ),
		'property'   => array(
			'id'   => (string) get_current_blog_id(),
			'name' => wp_specialchars_decode( (string) ( $settings['property_name'] ?? get_bloginfo( 'name' ) ), ENT_QUOTES ),
		),
		'user'       => array(
			'name'              => (string) $user->display_name,
			'role'              => azl_ehd_desk_role( $user ),
			'canManage'         => current_user_can( 'azl_manage_staff' ),
			'canManageAccounts' => current_user_can( 'azl_manage_accounts' ),
			'canManageLists'    => current_user_can( 'azl_manage_lists' ),
			// The modules this account may see (id => read|own|full), from the role matrix. Empty on a shared phone:
			// there it depends on the person who signs in with a PIN, worked out from `access` below.
			'modules'           => (object) Azl_Access::levels( Azl_Access::who( (int) $user->ID, null ) ),
		),
		// The role matrix (module => kind => level), so the desk hides what the server would refuse.
		'access'     => Azl_Access::matrix(),
		'theme'      => Azl_Theme::public_tokens( $theme ),
		'version'    => AZL_EHD_VERSION,
	);
	$json = wp_json_encode( $config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT );

	status_header( 200 );
	?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="<?php echo esc_attr( $theme['vars']['--azl-bg'] ); ?>">
<meta name="color-scheme" content="light">
<meta name="robots" content="noindex, nofollow">
<title><?php echo esc_html( sprintf( /* translators: %s: property name */ __( 'E-Help Desk · %s', 'azl-ehd' ), $config['property']['name'] ) ); ?></title>
<style nonce="<?php echo esc_attr( $nonce ); ?>"><?php echo Azl_Theme::css( $theme ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- constants and esc_url_raw URLs ?></style>
	<?php foreach ( $assets['css'] as $href ) : ?>
<link rel="stylesheet" href="<?php echo esc_url( $href ); ?>">
	<?php endforeach; ?>
</head>
<body>
<div id="azl-root"></div>
	<?php
	// phpcs:disable WordPress.Security.EscapeOutput.OutputNotEscaped -- wp_get_*_tag escape their attributes; $json is wp_json_encode with JSON_HEX_* flags.
	echo wp_get_inline_script_tag( 'window.AZL = ' . $json . ';', array( 'nonce' => $nonce ) );
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
