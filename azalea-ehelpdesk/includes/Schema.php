<?php
/**
 * Tables, created and upgraded with dbDelta. One install is one property, so there is no org or
 * property column. Ids are client-made uuids (char 36, lower case). Times are BIGINT epoch ms.
 *
 * Idempotency (see Azl_Commands): every command first inserts its event row with INSERT IGNORE.
 * The unique key (op_id, entity_id, what) makes a replayed op insert nothing, and the command stops
 * before touching anything else. Counters are bumped only after that claim, inside the same
 * transaction, so ticket numbers have no gaps.
 *
 * dbDelta rules kept here: one field per line, two spaces after PRIMARY KEY, KEY not INDEX,
 * lower-case types, no foreign keys (dbDelta cannot manage them; the code keeps references valid).
 *
 * @package azl-ehd
 */

defined( 'ABSPATH' ) || exit;

final class Azl_Schema {

	/**
	 * 2: azl_updates and the counters for the new ticket numbers (wave 1 of the modules).
	 * 3: Requests parity (wave 2), additive only: requests.hdo, requests.staff_name, requests.source widened to 20
	 *    (staff_request); items.relayed_by, on_site_at, prev_status, x_kind, x_note, remarks. All nullable.
	 */
	const VERSION  = '3';
	const OPTION   = 'azl_db_version';
	/** inq, hs, cr, tr: Inquiries I-0001, House Status HS-0001, Crisis cases CR-0001, Transport TR-0001. */
	const COUNTERS = array( 'ticket', 'wo', 'inc', 'change', 'inq', 'hs', 'cr', 'tr' );

	/** The stored database version: VERSION, plus every module and its version (Azl_Modules::signature()). */
	public static function db_version(): string {
		$mods = class_exists( 'Azl_Modules' ) ? Azl_Modules::signature() : '';
		return '' === $mods ? self::VERSION : self::VERSION . '+' . $mods;
	}

	/** Creates or upgrades the tables, the plugin's and every module's. Additive and safe to run again. */
	public static function install(): void {
		if ( ! function_exists( 'dbDelta' ) ) {
			require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		}
		dbDelta( self::sql() );
		$seq   = Azl_Db::t( 'seq' );
		$names = array_unique( array_merge( self::COUNTERS, class_exists( 'Azl_Modules' ) ? Azl_Modules::sequences() : array() ) );
		foreach ( $names as $name ) {
			Azl_Db::exec( Azl_Db::insert_ignore() . " INTO $seq (name, val) VALUES (%s, 0)", array( $name ) );
		}
		// Autoloaded: maybe_upgrade() reads it on every request (plugins_loaded), so it must cost no query.
		update_option( self::OPTION, self::db_version(), true );
	}

	/** Runs on plugins_loaded: upgrades once when the plugin or a module changed its tables. */
	public static function maybe_upgrade(): void {
		if ( get_option( self::OPTION ) !== self::db_version() ) {
			self::install();
		}
	}

	/** ENGINE and charset for a CREATE TABLE, for module schemas. */
	public static function table_options(): string {
		global $wpdb;
		return 'ENGINE=InnoDB ' . $wpdb->get_charset_collate();
	}

	/**
	 * Drops every plugin table. Only uninstall.php calls this, and only when the owner switched on
	 * "delete all help desk data". Uses $wpdb alone: uninstall loads just this file and Caps.php.
	 */
	public static function uninstall(): void {
		global $wpdb;
		foreach ( self::TABLES as $t ) {
			$wpdb->query( 'DROP TABLE IF EXISTS ' . $wpdb->prefix . 'azl_' . $t ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		}
		// Module tables (modules are not loaded during uninstall): every other azl_ table of this site.
		$like = $wpdb->esc_like( $wpdb->prefix . 'azl_' ) . '%';
		foreach ( (array) $wpdb->get_col( $wpdb->prepare( 'SHOW TABLES LIKE %s', $like ) ) as $t ) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			if ( preg_match( '/^[A-Za-z0-9_]+$/', (string) $t ) ) {
				$wpdb->query( "DROP TABLE IF EXISTS `{$t}`" ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared,WordPress.DB.DirectDatabaseQuery
			}
		}
		delete_option( self::OPTION );
	}

	const TABLES = array( 'requests', 'items', 'work_orders', 'clean_tasks', 'incidents', 'handovers', 'events', 'staff', 'seq', 'updates' );

	/** @return string[] One CREATE TABLE statement per table. */
	public static function sql(): array {
		global $wpdb;
		$p = $wpdb->prefix . 'azl_';
		$c = 'ENGINE=InnoDB ' . $wpdb->get_charset_collate();

		$core = array(
			"CREATE TABLE {$p}staff (
  id char(36) NOT NULL,
  wp_user_id bigint(20) unsigned DEFAULT NULL,
  name varchar(80) NOT NULL,
  initials varchar(4) NOT NULL,
  role varchar(20) NOT NULL,
  title varchar(60) NOT NULL,
  dept varchar(20) DEFAULT NULL,
  on_shift tinyint(1) NOT NULL DEFAULT 1,
  active tinyint(1) NOT NULL DEFAULT 1,
  pin_hash varchar(255) DEFAULT NULL,
  pin_failed int(11) NOT NULL DEFAULT 0,
  pin_locked_until bigint(20) DEFAULT NULL,
  created_at bigint(20) NOT NULL,
  updated_at bigint(20) NOT NULL,
  PRIMARY KEY  (id),
  KEY dept_shift (active,dept,on_shift,role),
  KEY wp_user_id (wp_user_id)
) $c;",
			"CREATE TABLE {$p}requests (
  id char(36) NOT NULL,
  ticket_no int(11) unsigned NOT NULL,
  room varchar(40) NOT NULL,
  source varchar(20) NOT NULL,
  remarks text DEFAULT NULL,
  logged_by char(36) DEFAULT NULL,
  vip tinyint(1) NOT NULL DEFAULT 0,
  incomplete tinyint(1) NOT NULL DEFAULT 0,
  safety_id char(36) DEFAULT NULL,
  hdo char(36) DEFAULT NULL,
  staff_name varchar(120) DEFAULT NULL,
  op_id char(36) NOT NULL,
  created_at bigint(20) NOT NULL,
  updated_at bigint(20) NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY ticket_no (ticket_no),
  UNIQUE KEY op_id (op_id),
  KEY created_at (created_at)
) $c;",
			"CREATE TABLE {$p}items (
  id char(36) NOT NULL,
  request_id char(36) NOT NULL,
  pos smallint(5) unsigned NOT NULL DEFAULT 0,
  name varchar(120) NOT NULL,
  qty int(11) NOT NULL DEFAULT 1,
  dept varchar(20) NOT NULL,
  assignee char(36) DEFAULT NULL,
  status varchar(20) NOT NULL DEFAULT 'new',
  hold_reason varchar(20) DEFAULT NULL,
  created_at bigint(20) NOT NULL,
  updated_at bigint(20) NOT NULL,
  ack_at bigint(20) DEFAULT NULL,
  done_at bigint(20) DEFAULT NULL,
  hold_since bigint(20) DEFAULT NULL,
  held_ms bigint(20) NOT NULL DEFAULT 0,
  sla_min int(11) NOT NULL,
  depends_on char(36) DEFAULT NULL,
  x_from char(36) DEFAULT NULL,
  wo_id char(36) DEFAULT NULL,
  st_before_esc varchar(20) DEFAULT NULL,
  relayed_by char(36) DEFAULT NULL,
  on_site_at bigint(20) DEFAULT NULL,
  prev_status varchar(20) DEFAULT NULL,
  x_kind varchar(10) DEFAULT NULL,
  x_note varchar(191) DEFAULT NULL,
  remarks varchar(500) DEFAULT NULL,
  PRIMARY KEY  (id),
  KEY request_id (request_id,created_at),
  KEY open_items (status,created_at),
  KEY dept_queue (dept,status,created_at),
  KEY assignee (assignee,status)
) $c;",
			"CREATE TABLE {$p}work_orders (
  id char(36) NOT NULL,
  wo_no int(11) unsigned NOT NULL,
  area varchar(80) NOT NULL,
  loc varchar(80) NOT NULL,
  descr text NOT NULL,
  priority varchar(10) NOT NULL DEFAULT 'normal',
  dept varchar(20) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'reported',
  reported_by char(36) DEFAULT NULL,
  encoded_by char(36) DEFAULT NULL,
  assessment text DEFAULT NULL,
  assign_type varchar(10) DEFAULT NULL,
  contractor varchar(120) DEFAULT NULL,
  est_cost decimal(12,2) DEFAULT NULL,
  actual_cost decimal(12,2) DEFAULT NULL,
  target_end bigint(20) DEFAULT NULL,
  src_item_id char(36) DEFAULT NULL,
  op_id char(36) NOT NULL,
  created_at bigint(20) NOT NULL,
  updated_at bigint(20) NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY wo_no (wo_no),
  UNIQUE KEY op_id (op_id),
  KEY status_created (status,created_at)
) $c;",
			"CREATE TABLE {$p}clean_tasks (
  id char(36) NOT NULL,
  room varchar(40) NOT NULL,
  type varchar(20) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'scheduled',
  assignee char(36) DEFAULT NULL,
  created_at bigint(20) NOT NULL,
  updated_at bigint(20) NOT NULL,
  PRIMARY KEY  (id),
  KEY status_room (status,room)
) $c;",
			"CREATE TABLE {$p}incidents (
  id char(36) NOT NULL,
  inc_no int(11) unsigned NOT NULL,
  hazard varchar(20) NOT NULL,
  rooms text NOT NULL,
  report text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active',
  called911_by char(36) DEFAULT NULL,
  called911_at bigint(20) DEFAULT NULL,
  op_id char(36) NOT NULL,
  created_at bigint(20) NOT NULL,
  updated_at bigint(20) NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY inc_no (inc_no),
  UNIQUE KEY op_id (op_id),
  KEY status_hazard (status,hazard,created_at)
) $c;",
			"CREATE TABLE {$p}handovers (
  id char(36) NOT NULL,
  signed_by char(36) DEFAULT NULL,
  note text DEFAULT NULL,
  op_id char(36) NOT NULL,
  created_at bigint(20) NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY op_id (op_id),
  KEY created_at (created_at)
) $c;",
			"CREATE TABLE {$p}events (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  entity varchar(20) NOT NULL,
  entity_id char(36) NOT NULL,
  what varchar(191) NOT NULL,
  by_staff char(36) DEFAULT NULL,
  op_id char(36) NOT NULL,
  created_at bigint(20) NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY op_entity_what (op_id,entity_id,what),
  KEY entity (entity,entity_id,created_at),
  KEY created_at (created_at)
) $c;",
			"CREATE TABLE {$p}seq (
  name varchar(20) NOT NULL,
  val bigint(20) unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY  (name)
) $c;",
			// Progress notes of any module (Azl_Updates). A replayed op adds nothing: unique op + entity + record.
			"CREATE TABLE {$p}updates (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  entity varchar(20) NOT NULL,
  entity_id char(36) NOT NULL,
  text text NOT NULL,
  by_staff char(36) DEFAULT NULL,
  op_id char(36) NOT NULL,
  created_at bigint(20) NOT NULL,
  updated_at bigint(20) NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY op_entity (op_id,entity,entity_id),
  KEY entity (entity,entity_id,created_at)
) $c;",
		);
		return array_merge( $core, class_exists( 'Azl_Modules' ) ? Azl_Modules::schema() : array() );
	}
}
