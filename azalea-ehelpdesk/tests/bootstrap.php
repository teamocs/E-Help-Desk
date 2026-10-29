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

require __DIR__ . '/Wpdb_Sqlite.php';
foreach ( array( 'Db', 'Rules', 'Schema', 'Pin', 'Staff', 'Caps', 'Commands', 'Snapshot', 'Rest' ) as $azl_class ) {
	require __DIR__ . '/../includes/' . $azl_class . '.php';
}

/* ---------- WordPress stand-ins ---------- */

$GLOBALS['azl_wp'] = array();

function azl_wp_reset(): void {
	$GLOBALS['azl_wp'] = array(
		'options' => array(),
		'meta'    => array(),
		'user'    => 0,
		'caps'    => array(), // user id => [cap => true]
		'roles'   => array(),
		'routes'  => array(),
	);
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
function user_can( $user_id, $cap ) {
	return ! empty( $GLOBALS['azl_wp']['caps'][ (int) $user_id ][ $cap ] );
}
function current_user_can( $cap ) {
	return user_can( get_current_user_id(), $cap );
}
function get_userdata( $id ) {
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
	public function add_cap( $cap ) {
		$this->capabilities[ $cap ] = true;
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

/** dbDelta: the real CREATE TABLE text, translated for SQLite. */
function dbDelta( $queries ) {
	foreach ( (array) $queries as $q ) {
		foreach ( azl_sqlite_ddl( $q ) as $stmt ) {
			$GLOBALS['wpdb']->pdo->exec( $stmt );
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
