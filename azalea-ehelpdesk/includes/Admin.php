<?php
/**
 * wp-admin: the "E-Help Desk" menu and its Settings page (option azl_settings).
 *
 * @package AzaleaEHelpdesk
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Settings page through the Settings API. Capability azl_manage_settings, or manage_options where that role cap
 * has not been installed.
 */
final class Azl_Admin {

	const OPTION = 'azl_settings';
	const GROUP  = 'azl_ehd_settings';
	const SLUG   = 'azl-ehd';

	/**
	 * Defaults for every setting.
	 *
	 * @return array{property_name: string, rooms: string[], poll_seconds: int, delete_on_uninstall: bool}
	 */
	public static function defaults() {
		return array(
			'property_name'       => (string) get_bloginfo( 'name' ),
			'rooms'               => array(),
			'poll_seconds'        => 5,
			'delete_on_uninstall' => false,
		);
	}

	/**
	 * The saved settings merged over the defaults. Safe to call from anywhere (REST, shell, uninstall).
	 *
	 * @return array{property_name: string, rooms: string[], poll_seconds: int, delete_on_uninstall: bool}
	 */
	public static function settings() {
		$saved = get_option( self::OPTION, array() );
		$all   = array_merge( self::defaults(), is_array( $saved ) ? $saved : array() );
		if ( '' === trim( (string) $all['property_name'] ) ) {
			$all['property_name'] = self::defaults()['property_name'];
		}
		$all['poll_seconds'] = max( 5, min( 30, (int) $all['poll_seconds'] ) );
		return $all;
	}

	/**
	 * The capability that may change settings.
	 *
	 * @return string
	 */
	public static function cap() {
		return current_user_can( 'azl_manage_settings' ) ? 'azl_manage_settings' : 'manage_options';
	}

	/**
	 * Hook into wp-admin.
	 */
	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_init', array( __CLASS__, 'register' ) );
		// options.php checks manage_options unless told otherwise.
		add_filter( 'option_page_capability_' . self::GROUP, array( __CLASS__, 'cap' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( AZL_EHD_FILE ), array( __CLASS__, 'action_links' ) );
	}

	/**
	 * The menu and its Settings page.
	 */
	public static function menu() {
		$cap = self::cap();
		add_menu_page( __( 'E-Help Desk', 'azl-ehd' ), __( 'E-Help Desk', 'azl-ehd' ), $cap, self::SLUG, array( __CLASS__, 'page' ), 'dashicons-sos', 58 );
		add_submenu_page( self::SLUG, __( 'E-Help Desk settings', 'azl-ehd' ), __( 'Settings', 'azl-ehd' ), $cap, self::SLUG, array( __CLASS__, 'page' ) );
	}

	/**
	 * Settings link on the Plugins screen.
	 *
	 * @param string[] $links Existing links.
	 * @return string[]
	 */
	public static function action_links( $links ) {
		$links[] = '<a href="' . esc_url( admin_url( 'admin.php?page=' . self::SLUG ) ) . '">' . esc_html__( 'Settings', 'azl-ehd' ) . '</a>';
		return $links;
	}

	/**
	 * Register the option and its fields.
	 */
	public static function register() {
		register_setting(
			self::GROUP,
			self::OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( __CLASS__, 'sanitize' ),
				'default'           => self::defaults(),
				'show_in_rest'      => false,
			)
		);
		add_settings_section( 'azl_main', __( 'This property', 'azl-ehd' ), '__return_false', self::SLUG );
		add_settings_field( 'azl_property_name', __( 'Property name', 'azl-ehd' ), array( __CLASS__, 'field_name' ), self::SLUG, 'azl_main', array( 'label_for' => 'azl_property_name' ) );
		add_settings_field( 'azl_rooms', __( 'Rooms', 'azl-ehd' ), array( __CLASS__, 'field_rooms' ), self::SLUG, 'azl_main', array( 'label_for' => 'azl_rooms' ) );
		add_settings_field( 'azl_poll', __( 'Refresh every', 'azl-ehd' ), array( __CLASS__, 'field_poll' ), self::SLUG, 'azl_main', array( 'label_for' => 'azl_poll' ) );
		add_settings_section( 'azl_data', __( 'Data', 'azl-ehd' ), '__return_false', self::SLUG );
		add_settings_field( 'azl_delete', __( 'On uninstall', 'azl-ehd' ), array( __CLASS__, 'field_delete' ), self::SLUG, 'azl_data' );
	}

	/**
	 * Clean the submitted settings. Unknown keys are dropped.
	 *
	 * @param mixed $input Raw form values.
	 * @return array
	 */
	public static function sanitize( $input ) {
		$input = is_array( $input ) ? $input : array();
		$rooms = array();
		foreach ( preg_split( '/\r\n|\r|\n/', (string) ( $input['rooms'] ?? '' ) ) as $line ) {
			$room = sanitize_text_field( $line );
			$room = function_exists( 'mb_substr' ) ? mb_substr( $room, 0, 20 ) : substr( $room, 0, 20 );
			if ( '' !== $room && ! in_array( $room, $rooms, true ) ) {
				$rooms[] = $room;
			}
		}
		$name = sanitize_text_field( (string) ( $input['property_name'] ?? '' ) );
		return array(
			'property_name'       => '' === $name ? self::defaults()['property_name'] : mb_substr( $name, 0, 80 ),
			'rooms'               => array_slice( $rooms, 0, 2000 ),
			'poll_seconds'        => max( 5, min( 30, absint( $input['poll_seconds'] ?? 5 ) ) ),
			'delete_on_uninstall' => ! empty( $input['delete_on_uninstall'] ),
		);
	}

	/** Property name field. */
	public static function field_name() {
		$s = self::settings();
		printf(
			'<input type="text" class="regular-text" id="azl_property_name" name="%1$s[property_name]" value="%2$s" maxlength="80" required>',
			esc_attr( self::OPTION ),
			esc_attr( $s['property_name'] )
		);
		echo '<p class="description">' . esc_html__( 'Shown on the desk, e.g. "Azalea Baguio".', 'azl-ehd' ) . '</p>';
	}

	/** Rooms list field, one per line. */
	public static function field_rooms() {
		$s = self::settings();
		printf(
			'<textarea id="azl_rooms" name="%1$s[rooms]" rows="10" cols="20" class="code">%2$s</textarea>',
			esc_attr( self::OPTION ),
			esc_textarea( implode( "\n", (array) $s['rooms'] ) )
		);
		echo '<p class="description">' . esc_html__( 'One room number per line. Duplicates are removed.', 'azl-ehd' ) . '</p>';
	}

	/** Polling interval field. */
	public static function field_poll() {
		$s = self::settings();
		printf(
			'<input type="number" id="azl_poll" name="%1$s[poll_seconds]" value="%2$d" min="5" max="30" step="1" class="small-text"> %3$s',
			esc_attr( self::OPTION ),
			(int) $s['poll_seconds'],
			esc_html__( 'seconds (5 to 30)', 'azl-ehd' )
		);
		echo '<p class="description">' . esc_html__( 'How often an open desk checks for other people\'s changes. Raise it if the host is slow.', 'azl-ehd' ) . '</p>';
	}

	/** Delete-on-uninstall checkbox (off by default). */
	public static function field_delete() {
		$s = self::settings();
		printf(
			'<label><input type="checkbox" name="%1$s[delete_on_uninstall]" value="1" %2$s> %3$s</label>',
			esc_attr( self::OPTION ),
			checked( ! empty( $s['delete_on_uninstall'] ), true, false ),
			esc_html__( 'Delete all help desk data when the plugin is deleted', 'azl-ehd' )
		);
		echo '<p class="description">' . esc_html__( 'Off keeps every request, work order, incident and staff record if the plugin is removed. Deactivating never deletes anything.', 'azl-ehd' ) . '</p>';
	}

	/**
	 * The Settings page.
	 */
	public static function page() {
		if ( ! current_user_can( self::cap() ) ) {
			wp_die( esc_html__( 'You are not allowed to change help desk settings.', 'azl-ehd' ), 403 );
		}
		$desk = function_exists( 'azl_ehd_desk_url' ) ? azl_ehd_desk_url() : home_url( '/helpdesk/' );
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'E-Help Desk', 'azl-ehd' ); ?></h1>
			<p>
				<a class="button button-primary" href="<?php echo esc_url( $desk ); ?>" target="_blank" rel="noopener"><?php esc_html_e( 'Open the desk', 'azl-ehd' ); ?></a>
				<code><?php echo esc_html( $desk ); ?></code>
			</p>
			<form method="post" action="<?php echo esc_url( admin_url( 'options.php' ) ); ?>">
				<?php
				settings_fields( self::GROUP );
				do_settings_sections( self::SLUG );
				submit_button();
				?>
			</form>
		</div>
		<?php
	}
}

Azl_Admin::init();
