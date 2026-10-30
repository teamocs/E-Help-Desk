<?php
/**
 * Test bootstrap: just enough WordPress (options, user meta, capabilities, roles, REST request and
 * response) to run the plugin classes without WordPress or MySQL.
 */

define( 'ABSPATH', __DIR__ . '/' );
define( 'ARRAY_A', 'ARRAY_A' );

ini_set( 'log_errors', '1' );
ini_set( 'error_log', sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'azl-ehd-tests.log' );
error_reporting( E_ALL );
set_error_handler(
	static function ( $no, $str, $file, $line ) {
		throw new ErrorException( $str, 0, $no, $file, $line ); // notices and warnings fail the test
	}
);

define( 'DAY_IN_SECONDS', 86400 );
define( 'HOUR_IN_SECONDS', 3600 );
define( 'AZL_TEST_HOME', 'https://azaleabaguio.test/staging2-baguio' );

require __DIR__ . '/Wpdb_Sqlite.php';

/* ---------- WordPress stand-ins ---------- */

$GLOBALS['azl_wp']    = array();
$GLOBALS['azl_hooks'] = array(); // hook => [callable, ...]; kept across tests (the plugin hooks in once, at load)

function azl_wp_reset(): void {
	$GLOBALS['azl_wp'] = array(
		'options'    => array( 'permalink_structure' => '/%postname%/' ),
		'meta'       => array(),
		'user'       => 0,
		'caps'       => array(), // user id => [cap => true]
		'roles'      => array(),
		'routes'     => array(),
		'users'      => array(), // id => ['user' => WP_User, 'pass' => string, 'key' => [key, time]|null]
		'transients' => array(),
		'mails'      => array(),
		'cookie'     => null,
		'destroyed'  => array(),
		'home'       => AZL_TEST_HOME,
		'icon'       => 'https://azaleabaguio.test/staging2-baguio/wp-content/uploads/icon.png',
		'logo_id'    => 0,
	);
	$_SERVER['REMOTE_ADDR']     = '203.0.113.7';
	$_SERVER['HTTP_USER_AGENT'] = 'TestBrowser/1.0';
	unset( $_SERVER['HTTP_X_FORWARDED_FOR'] );
}

/* hooks */
function add_action( $hook, $cb, $prio = 10, $args = 1 ) {
	$GLOBALS['azl_hooks'][ $hook ][] = $cb;
	return true;
}
function add_filter( $hook, $cb, $prio = 10, $args = 1 ) {
	return add_action( $hook, $cb, $prio, $args );
}
function apply_filters( $hook, $value, ...$args ) {
	foreach ( $GLOBALS['azl_hooks'][ $hook ] ?? array() as $cb ) {
		$value = $cb( $value, ...$args );
	}
	return $value;
}
function do_action( $hook, ...$args ) {
	$GLOBALS['azl_wp']['actions'][] = $hook;
}
function register_activation_hook( $file, $cb ) {}
function register_deactivation_hook( $file, $cb ) {}
function plugin_dir_path( $file ) {
	return rtrim( dirname( $file ), '/\\' ) . '/';
}
function plugin_basename( $file ) {
	return 'azalea-ehelpdesk/' . basename( $file );
}
function plugins_url( $path = '', $file = '' ) {
	return 'https://azaleabaguio.test/staging2-baguio/wp-content/plugins/azalea-ehelpdesk/' . ltrim( $path, '/' );
}

/* urls and escaping */
function home_url( $path = '' ) {
	return $GLOBALS['azl_wp']['home'] . '/' . ltrim( (string) $path, '/' );
}
function rest_url( $path = '' ) {
	return home_url( '/wp-json/' . ltrim( $path, '/' ) );
}
function wp_parse_url( $url, $component = -1 ) {
	return parse_url( $url, $component );
}
function add_query_arg( ...$a ) {
	if ( is_array( $a[0] ) ) {
		list( $args, $url ) = array( $a[0], $a[1] );
	} else {
		list( $args, $url ) = array( array( $a[0] => $a[1] ), $a[2] );
	}
	foreach ( $args as $k => $v ) {
		$url .= ( false === strpos( $url, '?' ) ? '?' : '&' ) . $k . '=' . $v;
	}
	return $url;
}
function wp_logout_url( $redirect = '' ) {
	return home_url( '/wp-login.php?action=logout' );
}
function esc_url( $u ) {
	return htmlspecialchars( (string) $u, ENT_QUOTES );
}
function esc_url_raw( $u ) {
	return (string) $u;
}
function esc_html( $s ) {
	return htmlspecialchars( (string) $s, ENT_QUOTES );
}
function esc_attr( $s ) {
	return htmlspecialchars( (string) $s, ENT_QUOTES );
}
function __( $s, $d = '' ) {
	return $s;
}
function esc_html__( $s, $d = '' ) {
	return esc_html( $s );
}
function esc_html_e( $s, $d = '' ) {
	echo esc_html( $s );
}
function language_attributes() {
	echo 'lang="en-US"';
}
function is_ssl() {
	return true;
}
function wp_doing_ajax() {
	return false;
}
function wp_unslash( $v ) {
	return $v;
}
function is_email( $e ) {
	return false !== filter_var( $e, FILTER_VALIDATE_EMAIL ) ? $e : false;
}
function sanitize_email( $e ) {
	return preg_replace( '/[^a-z0-9+_.@-]/i', '', (string) $e );
}
function get_site_icon_url( $size = 512 ) {
	return $GLOBALS['azl_wp']['icon'];
}
function get_theme_mod( $name, $default = false ) {
	return 'custom_logo' === $name ? $GLOBALS['azl_wp']['logo_id'] : $default;
}
function wp_get_attachment_image_url( $id, $size = 'thumbnail' ) {
	return $id ? AZL_TEST_HOME . '/wp-content/uploads/logo-' . $id . '.png' : false;
}
function wp_get_upload_dir() {
	return array( 'baseurl' => $GLOBALS['azl_wp']['uploads'] ?? AZL_TEST_HOME . '/wp-content/uploads' );
}

/* transients, on the test clock */
function get_transient( $key ) {
	$t = $GLOBALS['azl_wp']['transients'][ $key ] ?? null;
	return null !== $t && $t[1] > Azl_Db::now() ? $t[0] : false;
}
function set_transient( $key, $value, $ttl = 0 ) {
	$GLOBALS['azl_wp']['transients'][ $key ] = array( $value, Azl_Db::now() + 1000 * $ttl );
	return true;
}
function delete_transient( $key ) {
	unset( $GLOBALS['azl_wp']['transients'][ $key ] );
	return true;
}

/* users, sign-in and mail */
class WP_User {
	public $ID           = 0;
	public $user_login   = '';
	public $user_email   = '';
	public $display_name = '';
	public $roles        = array();
}
class WP_Error {
	public $code;
	public function __construct( $code = '', $message = '' ) {
		$this->code = $code;
	}
}
function is_wp_error( $x ) {
	return $x instanceof WP_Error;
}
final class WP_Session_Tokens {
	private $id;
	public static function get_instance( $id ) {
		$t     = new self();
		$t->id = $id;
		return $t;
	}
	public function destroy_all() {
		$GLOBALS['azl_wp']['destroyed'][] = $this->id;
	}
}

/** Adds a user whose capabilities come from its roles (administrators also get manage_options). */
function azl_add_user( int $id, string $email, array $roles, string $pass = 'correct horse 1' ): WP_User {
	$u               = new WP_User();
	$u->ID           = $id;
	$u->user_login   = $email;
	$u->user_email   = $email;
	$u->display_name = 'User ' . $id;
	$u->roles        = $roles;
	$caps            = array();
	foreach ( $roles as $r ) {
		$caps += array_filter( (array) ( $GLOBALS['azl_wp']['roles'][ $r ]->capabilities ?? array() ) );
		if ( 'administrator' === $r ) {
			$caps['manage_options'] = true;
		}
	}
	$GLOBALS['azl_wp']['caps'][ $id ]  = $caps;
	$GLOBALS['azl_wp']['users'][ $id ] = array( 'user' => $u, 'pass' => $pass, 'key' => null );
	return $u;
}
function get_user_by( $field, $value ) {
	foreach ( $GLOBALS['azl_wp']['users'] as $row ) {
		$have = 'email' === $field ? $row['user']->user_email : ( 'login' === $field ? $row['user']->user_login : $row['user']->ID );
		if ( 0 === strcasecmp( (string) $have, (string) $value ) ) {
			return $row['user'];
		}
	}
	return false;
}
function email_exists( $e ) {
	$u = get_user_by( 'email', $e );
	return $u ? $u->ID : false;
}
function username_exists( $l ) {
	$u = get_user_by( 'login', $l );
	return $u ? $u->ID : false;
}
function get_users( $args = array() ) {
	$out = array();
	foreach ( $GLOBALS['azl_wp']['users'] as $row ) {
		if ( array_intersect( $row['user']->roles, $args['role__in'] ?? array() ) ) {
			$out[] = $row['user'];
		}
	}
	return $out;
}
function wp_authenticate( $login, $pass ) {
	$u = get_user_by( 'login', $login );
	$u = $u ? $u : get_user_by( 'email', $login );
	if ( $u ) {
		$result = hash_equals( $GLOBALS['azl_wp']['users'][ $u->ID ]['pass'], (string) $pass ) ? $u : new WP_Error( 'incorrect_password' );
	} else {
		$result = new WP_Error( 'invalid_username' );
	}
	return apply_filters( 'authenticate', $result, $login, $pass );
}
function wp_set_auth_cookie( $id, $remember = false, $secure = '' ) {
	$GLOBALS['azl_wp']['cookie'] = array( $id, $remember, $secure );
}
function wp_logout() {
	$GLOBALS['azl_wp']['logged_out'] = $GLOBALS['azl_wp']['user'];
	$GLOBALS['azl_wp']['user']       = 0;
}
function is_user_logged_in() {
	return $GLOBALS['azl_wp']['user'] > 0;
}
function wp_get_current_user() {
	return $GLOBALS['azl_wp']['users'][ $GLOBALS['azl_wp']['user'] ]['user'] ?? new WP_User();
}
function wp_generate_password( $len = 12, $special = true, $extra = false ) {
	return substr( bin2hex( random_bytes( $len ) ), 0, $len );
}
function get_password_reset_key( $user ) {
	$key = substr( preg_replace( '/[^A-Za-z0-9]/', '', base64_encode( random_bytes( 30 ) ) ), 0, 20 );
	$GLOBALS['azl_wp']['users'][ $user->ID ]['key'] = array( $key, Azl_Db::now() );
	return $key;
}
function check_password_reset_key( $key, $login ) {
	$u = get_user_by( 'login', $login );
	$k = $u ? $GLOBALS['azl_wp']['users'][ $u->ID ]['key'] : null;
	if ( ! $k || ! hash_equals( $k[0], (string) $key ) || Azl_Db::now() - $k[1] > DAY_IN_SECONDS * 1000 ) {
		return new WP_Error( 'invalid_key' );
	}
	return $u;
}
function reset_password( $user, $pass ) {
	$GLOBALS['azl_wp']['users'][ $user->ID ]['pass'] = $pass;
	$GLOBALS['azl_wp']['users'][ $user->ID ]['key']  = null;
}
function wp_insert_user( $data ) {
	if ( username_exists( $data['user_login'] ) ) {
		return new WP_Error( 'existing_user_login' );
	}
	$id                  = 1 + max( array_merge( array( 100 ), array_keys( $GLOBALS['azl_wp']['users'] ) ) );
	$u                   = azl_add_user( $id, $data['user_email'], array( $data['role'] ), $data['user_pass'] );
	$u->display_name     = $data['display_name'];
	return $id;
}
function wp_mail( $to, $subject, $body ) {
	$GLOBALS['azl_wp']['mails'][] = compact( 'to', 'subject', 'body' );
	return true;
}
function delete_user_meta( $id, $key ) {
	unset( $GLOBALS['azl_wp']['meta'][ $id ][ $key ] );
	return true;
}

function get_option( $key, $default = false ) {
	return array_key_exists( $key, $GLOBALS['azl_wp']['options'] ) ? $GLOBALS['azl_wp']['options'][ $key ] : $default;
}
function add_option( $key, $value = '', $deprecated = '', $autoload = null ) {
	if ( array_key_exists( $key, $GLOBALS['azl_wp']['options'] ) ) {
		return false;
	}
	$GLOBALS['azl_wp']['options'][ $key ] = $value;
	return true;
}
function update_option( $key, $value, $autoload = null ) {
	$GLOBALS['azl_wp']['options'][ $key ] = $value;
	return true;
}
function delete_option( $key ) {
	unset( $GLOBALS['azl_wp']['options'][ $key ] );
	return true;
}
/** Same result as WordPress for the entities the site name can hold. */
function wp_specialchars_decode( $text, $quote_style = ENT_NOQUOTES ) {
	return htmlspecialchars_decode( (string) $text, $quote_style );
}

function get_bloginfo( $what = '' ) {
	return $GLOBALS['azl_test_blogname'] ?? 'Azalea Test Hotel';
}
function wp_json_encode( $data, $options = 0, $depth = 512 ) {
	return json_encode( $data, $options, $depth );
}
function sanitize_text_field( $s ) {
	$s = strip_tags( (string) $s );
	return trim( preg_replace( '/[\r\n\t ]+/', ' ', $s ) );
}
function sanitize_textarea_field( $s ) {
	return trim( strip_tags( (string) $s ) );
}
function get_current_user_id() {
	return $GLOBALS['azl_wp']['user'];
}
function user_can( $user, $cap ) {
	$id = is_object( $user ) ? (int) $user->ID : (int) $user;
	return ! empty( $GLOBALS['azl_wp']['caps'][ $id ][ $cap ] );
}
function current_user_can( $cap ) {
	return user_can( get_current_user_id(), $cap );
}
function get_userdata( $id ) {
	if ( isset( $GLOBALS['azl_wp']['users'][ $id ] ) ) {
		return $GLOBALS['azl_wp']['users'][ $id ]['user'];
	}
	return isset( $GLOBALS['azl_wp']['caps'][ $id ] ) ? (object) array( 'ID' => $id ) : false;
}
function get_user_meta( $id, $key, $single = false ) {
	return $GLOBALS['azl_wp']['meta'][ $id ][ $key ] ?? ( $single ? '' : array() );
}
function update_user_meta( $id, $key, $value ) {
	$GLOBALS['azl_wp']['meta'][ $id ][ $key ] = $value;
	return true;
}
function register_rest_route( $ns, $route, $args ) {
	$GLOBALS['azl_wp']['routes'][ $ns . $route ] = $args;
	return true;
}

final class Azl_Test_Role {
	public $capabilities;
	public function __construct( array $caps ) {
		$this->capabilities = $caps;
	}
	public function add_cap( $cap, $grant = true ) {
		$this->capabilities[ $cap ] = $grant;
	}
	public function remove_cap( $cap ) {
		unset( $this->capabilities[ $cap ] );
	}
}
function get_role( $slug ) {
	return $GLOBALS['azl_wp']['roles'][ $slug ] ?? null;
}
function add_role( $slug, $label, $caps ) {
	if ( isset( $GLOBALS['azl_wp']['roles'][ $slug ] ) ) {
		return null;
	}
	return $GLOBALS['azl_wp']['roles'][ $slug ] = new Azl_Test_Role( $caps );
}
function remove_role( $slug ) {
	unset( $GLOBALS['azl_wp']['roles'][ $slug ] );
}

/**
 * dbDelta: the real CREATE TABLE text, translated for SQLite. Like WordPress, a table that already exists gets the
 * columns it lacks (ALTER TABLE ADD COLUMN), so an upgrade over existing rows can be tested. Never drops anything.
 */
function dbDelta( $queries ) {
	$pdo = $GLOBALS['wpdb']->pdo;
	foreach ( (array) $queries as $q ) {
		$stmts = azl_sqlite_ddl( $q );
		preg_match( '/^CREATE TABLE IF NOT EXISTS (\w+) \(\n(.*)\n\)$/s', $stmts[0], $m );
		$have = array_column( $pdo->query( "PRAGMA table_info($m[1])" )->fetchAll( PDO::FETCH_ASSOC ), 'name' );
		foreach ( $have ? explode( ",\n", $m[2] ) : array() as $col ) {
			$name = strtok( trim( $col ), ' ' );
			if ( ! preg_match( '/^(PRIMARY|UNIQUE)\b/', trim( $col ) ) && ! in_array( $name, $have, true ) ) {
				$pdo->exec( "ALTER TABLE $m[1] ADD COLUMN " . trim( $col ) );
			}
		}
		foreach ( $stmts as $stmt ) {
			$pdo->exec( $stmt );
		}
	}
	return array();
}

class WP_REST_Request {
	private $method;
	private $params  = array();
	private $headers = array();
	private $body    = '';
	public function __construct( $method = 'GET', $route = '' ) {
		$this->method = $method;
	}
	private static function canon( $k ) {
		return str_replace( '-', '_', strtolower( $k ) );
	}
	public function set_header( $k, $v ) {
		$this->headers[ self::canon( $k ) ] = $v;
	}
	public function get_header( $k ) {
		return $this->headers[ self::canon( $k ) ] ?? null;
	}
	public function set_param( $k, $v ) {
		$this->params[ $k ] = $v;
	}
	public function get_param( $k ) {
		return $this->params[ $k ] ?? null;
	}
	public function set_body( $b ) {
		$this->body = $b;
	}
	public function get_body() {
		return $this->body;
	}
	public function get_json_params() {
		$d = json_decode( $this->body, true );
		return is_array( $d ) ? $d : null;
	}
}

class WP_REST_Response {
	public $data;
	public $status;
	public $headers = array();
	public function __construct( $data = null, $status = 200 ) {
		$this->data   = $data;
		$this->status = $status;
	}
	public function header( $k, $v ) {
		$this->headers[ $k ] = $v;
	}
	public function get_data() {
		return $this->data;
	}
	public function get_status() {
		return $this->status;
	}
	public function get_headers() {
		return $this->headers;
	}
}

/* ---------- the plugin itself (its main file loads every includes/*.php and adds its hooks) ---------- */

azl_wp_reset();
// Modules check their CREATE TABLE text when they register, which needs the table prefix: a database exists at load,
// as in WordPress. Each test still starts from a fresh one (azl_reset).
$GLOBALS['wpdb'] = new Wpdb_Sqlite();
require __DIR__ . '/../azalea-ehelpdesk.php';
if ( ! empty( $GLOBALS['azl_ehd_load_errors'] ) ) {
	fwrite( STDERR, "Plugin files failed to load:\n  " . implode( "\n  ", $GLOBALS['azl_ehd_load_errors'] ) . "\n" );
	exit( 1 );
}

/* ---------- per-test reset ---------- */

/** A fresh empty database with the plugin installed, a fixed clock, and no users. */
function azl_reset(): void {
	azl_wp_reset();
	$GLOBALS['wpdb']  = new Wpdb_Sqlite();
	Azl_Db::$dialect  = 'sqlite';
	Azl_Db::$clock    = 1_800_000_000_000;
	Azl_Schema::install();
}

/** Moves the fixed clock forward. */
function azl_advance( int $ms ): void {
	Azl_Db::$clock += $ms;
}
