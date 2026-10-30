<?php
/**
 * Cleaning (sidebar id cleaning): room cleaning tasks, the client prototype's module 4 (docs/MODULES-SPEC.md A.6).
 * Log a clean (type, room attendant, Lead or Backup, clock in now), schedule checkout rooms for a date, clock in and
 * out (the duration is clock-out minus clock-in), and edit a task.
 *
 * Table: the plugin's azl_clean_tasks, redeclared below with ADDITIVE columns only (nullable; old rows keep working).
 * Statuses stay scheduled, queued, ready, in_progress, done; the checkout and inspection rule that readies a room is
 * unchanged (Azl_Commands::close_item), and the built-in cleanSet ("Mark ready") stays.
 *
 *   logClean       (new)              -> in_progress (clock in now) or queued
 *   scheduleClean  (new, many rooms)  -> scheduled, with the date
 *   clockIn        ready, queued      -> in_progress (clock_in = now)
 *   clockOut       in_progress        -> done (clock_out = now)
 *   editClean      any                -> (unchanged)
 *
 * The cleaning type is a key of the editable list cleaningTypes (rows before wave 2 hold a label, shown as written).
 * Room attendants are active Housekeeping staff (Azl_Access::CLEANING_DEPT).
 *
 * @package azl-ehd
 */

defined( 'ABSPATH' ) || exit;

final class Azl_Module_Cleaning extends Azl_Module {

	const ROLES     = array( 'lead', 'backup' );
	const MAX_ROOMS = 30;
	const NOT_FOUND = 'Unknown cleaning task';

	/** command => [from statuses, to status (null: unchanged)]. */
	const TRANSITIONS = array(
		'logClean'      => array( array(), 'in_progress' ),
		'scheduleClean' => array( array(), 'scheduled' ),
		'clockIn'       => array( array( 'ready', 'queued' ), 'in_progress' ),
		'clockOut'      => array( array( 'in_progress' ), 'done' ),
		'editClean'     => array( array( 'scheduled', 'queued', 'ready', 'in_progress', 'done' ), null ),
	);

	public function id(): string {
		return 'cleaning';
	}

	public function schema() {
		return 'CREATE TABLE ' . Azl_Db::t( 'clean_tasks' ) . " (
  id char(36) NOT NULL,
  room varchar(40) NOT NULL,
  type varchar(20) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'scheduled',
  assignee char(36) DEFAULT NULL,
  created_at bigint(20) NOT NULL,
  updated_at bigint(20) NOT NULL,
  role varchar(10) DEFAULT NULL,
  sched_date bigint(20) DEFAULT NULL,
  checkout_at bigint(20) DEFAULT NULL,
  clock_in bigint(20) DEFAULT NULL,
  clock_out bigint(20) DEFAULT NULL,
  op_id char(36) DEFAULT NULL,
  PRIMARY KEY  (id),
  KEY status_room (status,room)
) " . Azl_Schema::table_options() . ';';
	}

	/** The prototype's cleaning types, labels as it writes them. */
	public function catalogLists(): array {
		$seed = array();
		foreach ( array( 'Regular', 'Checkout', 'Deep Clean', 'Touch-up', 'Pre-arrival', 'VIP Setup', 'Turndown' ) as $label ) {
			$seed[] = array( 'label' => $label );
		}
		return array(
			'cleaningTypes' => array(
				'label'    => array( 'cleaning type', 'cleaning types' ),
				'maxItems' => 30,
				'fields'   => array(),
				'seed'     => $seed,
			),
		);
	}

	public function commands(): array {
		$one = array( 'taskId' );
		return array(
			'logClean'      => array( 'ids' => $one, 'validate' => array( $this, 'check_log' ), 'run' => array( $this, 'log' ) ),
			'scheduleClean' => array( 'validate' => array( $this, 'check_schedule' ), 'run' => array( $this, 'schedule' ) ),
			'clockIn'       => array( 'ids' => $one, 'run' => array( $this, 'clock_in' ) ),
			'clockOut'      => array( 'ids' => $one, 'run' => array( $this, 'clock_out' ) ),
			'editClean'     => array( 'ids' => $one, 'run' => array( $this, 'edit' ) ),
		);
	}

	/* ---------- checks ---------- */

	private static function room( $v ): ?string {
		$r = Azl_Commands::line( $v );
		return '' === $r || mb_strlen( $r ) > Azl_Commands::ROOM_MAX ? null : $r;
	}

	/** An active cleaning type key (locks the lists for the command). */
	private static function type_ok( $key ): bool {
		return is_string( $key ) && null !== Azl_Catalog::active( Azl_Catalog::locked(), 'cleaningTypes', $key );
	}

	/** An active Housekeeping staff member. */
	private static function attendant_ok( $id ): bool {
		return Azl_Module_WorkOrders::staff_ok( $id, Azl_Access::CLEANING_DEPT );
	}

	private static function exists( string $id ): bool {
		return null !== Azl_Db::val( 'SELECT 1 FROM ' . Azl_Db::t( 'clean_tasks' ) . ' WHERE id = %s', array( $id ) );
	}

	private static function load( string $id ): ?array {
		return Azl_Db::row( 'SELECT * FROM ' . Azl_Db::t( 'clean_tasks' ) . ' WHERE id = %s' . Azl_Db::lock(), array( $id ) );
	}

	private static function refused( string $type, string $status ): ?string {
		return in_array( $status, self::TRANSITIONS[ $type ][0], true ) ? null : 'Not possible while the room is ' . str_replace( '_', ' ', $status );
	}

	/* ---------- logClean ---------- */

	public function check_log( array $cmd ): ?string {
		if ( null === self::room( $cmd['room'] ?? null ) ) {
			return 'Room required';
		}
		if ( ! self::type_ok( $cmd['cleanType'] ?? null ) ) {
			return 'Choose the cleaning type.';
		}
		if ( ! in_array( $cmd['role'] ?? null, self::ROLES, true ) ) {
			return 'Choose Lead or Backup.';
		}
		if ( ! is_bool( $cmd['clockIn'] ?? null ) ) {
			return 'Choose whether to clock in now.';
		}
		if ( isset( $cmd['attendantId'] ) && ! self::attendant_ok( $cmd['attendantId'] ) ) {
			return 'Choose a room attendant from Housekeeping.';
		}
		if ( true === $cmd['clockIn'] && ! isset( $cmd['attendantId'] ) ) {
			return 'Choose the room attendant who clocks in.';
		}
		return self::exists( $cmd['taskId'] ) ? 'This cleaning task already exists.' : null;
	}

	public function log( array $cmd, Azl_Commands $ctx ): array {
		$now = $cmd['clockIn'];
		if ( ! $ctx->claim( 'clean_task', $cmd['taskId'], $now ? 'Logged and clocked in' : 'Logged (queued)' ) ) {
			return $ctx->replay( $cmd );
		}
		Azl_Db::insert(
			'clean_tasks',
			array(
				'id'         => $cmd['taskId'],
				'room'       => self::room( $cmd['room'] ),
				'type'       => $cmd['cleanType'],
				'status'     => $now ? 'in_progress' : 'queued',
				'assignee'   => isset( $cmd['attendantId'] ) ? strtolower( $cmd['attendantId'] ) : null,
				'role'       => $cmd['role'],
				'clock_in'   => $now ? $ctx->now() : null,
				'op_id'      => $ctx->op(),
				'created_at' => $ctx->now(),
				'updated_at' => $ctx->now(),
			)
		);
		return Azl_Commands::ok();
	}

	/* ---------- scheduleClean: one task per room, for a checkout date ---------- */

	public function check_schedule( array $cmd ): ?string {
		if ( null === Azl_Module_WorkOrders::date_ms( $cmd['date'] ?? null ) ) {
			return 'Date required';
		}
		if ( ! self::type_ok( $cmd['cleanType'] ?? null ) ) {
			return 'Choose the cleaning type.';
		}
		$rooms = $cmd['rooms'] ?? null;
		$ids   = $cmd['taskIds'] ?? null;
		if ( ! is_array( $rooms ) || ! array_is_list( $rooms ) || array() === $rooms ) {
			return 'Add rooms';
		}
		if ( count( $rooms ) > self::MAX_ROOMS ) {
			return 'Schedule at most ' . self::MAX_ROOMS . ' rooms at a time.';
		}
		if ( ! is_array( $ids ) || ! array_is_list( $ids ) || count( $ids ) !== count( $rooms ) || count( array_unique( array_map( 'strtolower', array_filter( $ids, 'is_string' ) ) ) ) !== count( $ids ) ) {
			return 'Invalid id';
		}
		$seen = array();
		foreach ( $rooms as $i => $r ) {
			$room = self::room( $r );
			if ( null === $room ) {
				return 'Room ' . ( $i + 1 ) . ': enter a room of 1 to ' . Azl_Commands::ROOM_MAX . ' characters.';
			}
			if ( isset( $seen[ mb_strtolower( $room ) ] ) ) {
				return "Room $room is listed twice.";
			}
			$seen[ mb_strtolower( $room ) ] = true;
			if ( ! Azl_Db::is_uuid( $ids[ $i ] ) ) {
				return 'Invalid id';
			}
			if ( self::exists( strtolower( $ids[ $i ] ) ) ) {
				return 'This cleaning task already exists.';
			}
		}
		return null;
	}

	public function schedule( array $cmd, Azl_Commands $ctx ): array {
		$ids  = array_map( 'strtolower', $cmd['taskIds'] );
		$date = Azl_Module_WorkOrders::date_ms( $cmd['date'] );
		$what = 'Scheduled for ' . $cmd['date'];
		if ( ! $ctx->claim( 'clean_task', $ids[0], $what ) ) {
			return $ctx->replay( $cmd );
		}
		foreach ( $cmd['rooms'] as $i => $r ) {
			if ( $i > 0 ) {
				$ctx->claim( 'clean_task', $ids[ $i ], $what );
			}
			Azl_Db::insert(
				'clean_tasks',
				array(
					'id'         => $ids[ $i ],
					'room'       => self::room( $r ),
					'type'       => $cmd['cleanType'],
					'status'     => 'scheduled',
					'role'       => 'lead',
					'sched_date' => $date,
					'op_id'      => $ctx->op(),
					'created_at' => $ctx->now(),
					'updated_at' => $ctx->now(),
				)
			);
		}
		return Azl_Commands::ok( array( 'scheduled' => count( $ids ) ) );
	}

	/* ---------- clock in and out ---------- */

	public function clock_in( array $cmd, Azl_Commands $ctx ): array {
		if ( isset( $cmd['attendantId'] ) && ! self::attendant_ok( $cmd['attendantId'] ) ) {
			return Azl_Commands::fail( 'Choose a room attendant from Housekeeping.' );
		}
		if ( isset( $cmd['role'] ) && ! in_array( $cmd['role'], self::ROLES, true ) ) {
			return Azl_Commands::fail( 'Choose Lead or Backup.' );
		}
		$t = self::load( $cmd['taskId'] );
		if ( null === $t ) {
			return Azl_Commands::fail( self::NOT_FOUND );
		}
		$no = self::refused( 'clockIn', $t['status'] );
		if ( null !== $no ) {
			return Azl_Commands::fail( $no );
		}
		$who = isset( $cmd['attendantId'] ) ? strtolower( $cmd['attendantId'] ) : $t['assignee'];
		if ( null === $who ) {
			return Azl_Commands::fail( 'Choose the room attendant who clocks in.' );
		}
		if ( ! $ctx->claim( 'clean_task', $t['id'], 'Clocked in' ) ) {
			return $ctx->replay( $cmd );
		}
		$set = array( 'status' => 'in_progress', 'assignee' => $who, 'clock_in' => $ctx->now(), 'clock_out' => null, 'updated_at' => $ctx->now() );
		if ( isset( $cmd['role'] ) ) {
			$set['role'] = $cmd['role'];
		}
		Azl_Db::update( 'clean_tasks', $set, array( 'id' => $t['id'] ) );
		return Azl_Commands::ok();
	}

	public function clock_out( array $cmd, Azl_Commands $ctx ): array {
		$t = self::load( $cmd['taskId'] );
		if ( null === $t ) {
			return Azl_Commands::fail( self::NOT_FOUND );
		}
		$no = self::refused( 'clockOut', $t['status'] );
		if ( null !== $no ) {
			return Azl_Commands::fail( $no );
		}
		if ( ! $ctx->claim( 'clean_task', $t['id'], 'Clocked out' ) ) {
			return $ctx->replay( $cmd );
		}
		Azl_Db::update(
			'clean_tasks',
			array(
				'status'     => 'done',
				'clock_in'   => $t['clock_in'] ?? $ctx->now(), // a task started before clock times existed
				'clock_out'  => $ctx->now(),
				'updated_at' => $ctx->now(),
			),
			array( 'id' => $t['id'] )
		);
		$mins = null === $t['clock_in'] ? 0 : intdiv( $ctx->now() - (int) $t['clock_in'], 60000 );
		return Azl_Commands::ok( array( 'minutes' => $mins ) );
	}

	/* ---------- editClean ---------- */

	public function edit( array $cmd, Azl_Commands $ctx ): array {
		$cat_needed = array_key_exists( 'cleanType', $cmd );
		if ( $cat_needed ) {
			Azl_Catalog::locked(); // lock order: the lists before the task row
		}
		$t = self::load( $cmd['taskId'] );
		if ( null === $t ) {
			return Azl_Commands::fail( self::NOT_FOUND );
		}
		$set     = array();
		$changed = array();
		if ( array_key_exists( 'room', $cmd ) ) {
			$room = self::room( $cmd['room'] );
			if ( null === $room ) {
				return Azl_Commands::fail( 'Room required' );
			}
			if ( $room !== $t['room'] ) {
				$set['room'] = $room;
				$changed[]   = 'room';
			}
		}
		if ( $cat_needed && $cmd['cleanType'] !== $t['type'] ) {
			if ( ! self::type_ok( $cmd['cleanType'] ) ) {
				return Azl_Commands::fail( 'Choose the cleaning type.' );
			}
			$set['type'] = $cmd['cleanType'];
			$changed[]   = 'type';
		}
		// attendantId (a uuid) sets the attendant; clearAttendant: true removes it (an id field cannot be empty).
		if ( array_key_exists( 'attendantId', $cmd ) || true === ( $cmd['clearAttendant'] ?? null ) ) {
			$who = $cmd['attendantId'] ?? null;
			if ( null !== $who && ! self::attendant_ok( $who ) ) {
				return Azl_Commands::fail( 'Choose a room attendant from Housekeeping.' );
			}
			if ( null === $who && 'in_progress' === $t['status'] ) {
				return Azl_Commands::fail( 'A room being cleaned keeps its attendant.' );
			}
			$who = null === $who ? null : strtolower( $who );
			if ( $who !== $t['assignee'] ) {
				$set['assignee'] = $who;
				$changed[]       = 'attendant';
			}
		}
		if ( array_key_exists( 'role', $cmd ) && $cmd['role'] !== $t['role'] ) {
			if ( ! in_array( $cmd['role'], self::ROLES, true ) ) {
				return Azl_Commands::fail( 'Choose Lead or Backup.' );
			}
			$set['role'] = $cmd['role'];
			$changed[]   = 'role';
		}
		if ( array_key_exists( 'schedDate', $cmd ) ) {
			$d = '' === $cmd['schedDate'] || null === $cmd['schedDate'] ? null : Azl_Module_WorkOrders::date_ms( $cmd['schedDate'] );
			if ( null === $d && '' !== $cmd['schedDate'] && null !== $cmd['schedDate'] ) {
				return Azl_Commands::fail( 'The scheduled date is not a valid date.' );
			}
			if ( null === $d && 'scheduled' === $t['status'] ) {
				return Azl_Commands::fail( 'A scheduled room needs its date.' );
			}
			if ( $d !== ( null === $t['sched_date'] ? null : (int) $t['sched_date'] ) ) {
				$set['sched_date'] = $d;
				$changed[]         = 'scheduled date';
			}
		}
		if ( array() === $changed ) {
			return Azl_Commands::fail( 'Nothing to change.' );
		}
		if ( ! $ctx->claim( 'clean_task', $t['id'], 'Edited: ' . implode( ', ', $changed ) ) ) {
			return $ctx->replay( $cmd );
		}
		Azl_Db::update( 'clean_tasks', $set + array( 'updated_at' => $ctx->now() ), array( 'id' => $t['id'] ) );
		return Azl_Commands::ok();
	}
}

Azl_Modules::register( new Azl_Module_Cleaning() );
