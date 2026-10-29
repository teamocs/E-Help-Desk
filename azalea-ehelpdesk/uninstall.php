<?php
/**
 * Runs when the plugin is deleted in wp-admin. Keeps every record unless the owner switched on
 * "Delete all help desk data when the plugin is deleted" (azl_settings[delete_on_uninstall]).
 *
 * @package AzaleaEHelpdesk
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

$azl_settings = get_option( 'azl_settings', array() );
if ( ! is_array( $azl_settings ) || empty( $azl_settings['delete_on_uninstall'] ) ) {
	return; // Default: keep all data, options and roles.
}

$azl_dir = __DIR__ . '/includes/';
foreach ( array( 'Schema.php', 'Caps.php' ) as $azl_file ) {
	if ( is_readable( $azl_dir . $azl_file ) ) {
		try {
			require_once $azl_dir . $azl_file;
		} catch ( \Throwable $e ) {
			unset( $e ); // Fall back to the generic clean-up below.
		}
	}
}

if ( class_exists( 'Azl_Schema' ) && method_exists( 'Azl_Schema', 'uninstall' ) ) {
	Azl_Schema::uninstall();
} else {
	global $wpdb;
	$azl_like   = $wpdb->esc_like( $wpdb->prefix . 'azl_' ) . '%';
	$azl_tables = $wpdb->get_col( $wpdb->prepare( 'SHOW TABLES LIKE %s', $azl_like ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
	foreach ( (array) $azl_tables as $azl_table ) {
		// Table names come from SHOW TABLES for this site's own prefix, not from user input.
		if ( preg_match( '/^[A-Za-z0-9_]+$/', $azl_table ) ) {
			$wpdb->query( "DROP TABLE IF EXISTS `{$azl_table}`" ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared,WordPress.DB.DirectDatabaseQuery,WordPress.DB.DirectDatabaseQuery.SchemaChange
		}
	}
}

if ( class_exists( 'Azl_Caps' ) && method_exists( 'Azl_Caps', 'uninstall' ) ) {
	Azl_Caps::uninstall();
} else {
	foreach ( array( 'azl_owner', 'azl_manager', 'azl_supervisor', 'azl_device' ) as $azl_role ) {
		remove_role( $azl_role );
	}
	$azl_admin = get_role( 'administrator' );
	if ( $azl_admin ) {
		foreach ( array( 'azl_use_desk', 'azl_act_directly', 'azl_manage_staff', 'azl_manage_settings', 'azl_manage_accounts', 'azl_manage_lists' ) as $azl_cap ) {
			$azl_admin->remove_cap( $azl_cap );
		}
	}
}

// Options: azl_settings, azl_db_version, the signing secret and any other azl_ option.
global $wpdb;
$wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s", $wpdb->esc_like( 'azl_' ) . '%', $wpdb->esc_like( 'azl_ehd_' ) . '%' ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
wp_cache_flush();
