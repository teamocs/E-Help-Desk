<?php
/**
 * Work Orders (sidebar id workorders): the maintenance lifecycle of the client prototype's module 5
 * (docs/MODULES-SPEC.md A.7): report, assess, start, progress updates, hold, extend the deadline, outsource mid-job,
 * complete with the actual cost, reopen; plus preventive jobs that wait as Scheduled until someone opens them.
 *
 * Table: the plugin's azl_work_orders, redeclared below with ADDITIVE columns only (nullable; dbDelta adds what a site
 * lacks and never changes or drops a column; Azl_Modules refuses a redeclaration that is not a strict superset).
 * Rows written before wave 2 keep their values: priority 'normal' stays and reads as Medium.
 *
 * Commands here (new): reportWo, editWo, updateWo (with an optional deadline extension and transfer to outsource),
 * openWo. The built-in assessWo, startWo, holdWo, completeWo and reopenWo stay in Azl_Commands and read the
 * transition table below. Progress notes are azl_updates rows (entity work_order); history is azl_events.
 * Dates (requested, target start and end, scheduled) are stored as epoch ms of midnight in the hotel's time zone.
 *
 * @package azl-ehd
 */

defined( 'ABSPATH' ) || exit;

final class Azl_Module_WorkOrders extends Azl_Module {

	const STATUSES = array( 'scheduled', 'reported', 'assessed', 'in_progress', 'on_hold', 'done' );

	/**
	 * The allowed transitions: command => [from statuses, to status (null: unchanged)]. One table for the module's
	 * commands and the built-in ones in Azl_Commands (step_wo); src/modules/workorders/model.ts keeps a copy (a desk
	 * test compares the two).
	 *
	 *   reportWo    (new)                              -> reported, or scheduled with a schedule date (preventive)
	 *   openWo      scheduled                          -> reported
	 *   assessWo    reported                           -> assessed
	 *   startWo     assessed, on_hold                  -> in_progress  (from on_hold this is Resume)
	 *   holdWo      in_progress                        -> on_hold
	 *   updateWo    in_progress, on_hold               -> (unchanged)  progress note, extend deadline, outsource
	 *   completeWo  in_progress, on_hold, assessed     -> done         closes the source request item
	 *   reopenWo    done                               -> assessed     clears the actual end and cost
	 *   editWo      any                                -> (unchanged)
	 */
	const TRANSITIONS = array(
		'reportWo'   => array( array(), 'reported' ),
		'openWo'     => array( array( 'scheduled' ), 'reported' ),
		'assessWo'   => array( array( 'reported' ), 'assessed' ),
		'startWo'    => array( array( 'assessed', 'on_hold' ), 'in_progress' ),
		'holdWo'     => array( array( 'in_progress' ), 'on_hold' ),
		'updateWo'   => array( array( 'in_progress', 'on_hold' ), null ),
		'completeWo' => array( array( 'in_progress', 'on_hold', 'assessed' ), 'done' ),
		'reopenWo'   => array( array( 'done' ), 'assessed' ),
		'editWo'     => array( array( 'scheduled', 'reported', 'assessed', 'in_progress', 'on_hold', 'done' ), null ),
	);

	/** New work orders use the prototype's priorities. 'normal' (before wave 2) stays readable as Medium. */
	const PRIORITIES = array( 'low', 'medium', 'high', 'urgent' );
	const TZ         = 'Asia/Manila';
	const LOC_MAX    = 80;
	const REASON_MAX = 200;
	const HOLD_MAX   = 255;
	const NOT_FOUND  = 'Unknown work order';

	public function id(): string {
		return 'workorders';
	}

	public function schema() {
		return 'CREATE TABLE ' . Azl_Db::t( 'work_orders' ) . " (
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
  reporter_dept varchar(20) DEFAULT NULL,
  requested_date bigint(20) DEFAULT NULL,
  target_start bigint(20) DEFAULT NULL,
  assignee char(36) DEFAULT NULL,
  assessed_by char(36) DEFAULT NULL,
  assessed_at bigint(20) DEFAULT NULL,
  actual_start bigint(20) DEFAULT NULL,
  actual_end bigint(20) DEFAULT NULL,
  hold_reason varchar(255) DEFAULT NULL,
  completion_notes text DEFAULT NULL,
  sched_date bigint(20) DEFAULT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY wo_no (wo_no),
  UNIQUE KEY op_id (op_id),
  KEY status_created (status,created_at)
) " . Azl_Schema::table_options() . ';';
	}

	public function catalogLists(): array {
		$seed = array();
		foreach ( array( 'Room', 'Public Area', 'Office', 'Staff House', 'Function Room', 'Basement Parking', 'Drivers Quarters', 'Other' ) as $label ) {
			$seed[] = array( 'label' => $label );
		}
		return array(
			'woAreas' => array(
				'label'    => array( 'area', 'areas' ),
				'maxItems' => 40,
				'fields'   => array(),
				'seed'     => $seed,
			),
		);
	}

	public function commands(): array {
		$ids = array( 'woId' );
		return array(
			'reportWo' => array(
				'ids'      => $ids,
				'validate' => array( $this, 'check_report' ),
				'run'      => array( $this, 'report' ),
				'prior'    => static function ( string $id ): array {
					$n = Azl_Db::val( 'SELECT wo_no FROM ' . Azl_Db::t( 'work_orders' ) . ' WHERE id = %s', array( $id ) );
					return null === $n ? array() : array( 'woNo' => (int) $n );
				},
			),
			'editWo'   => array( 'ids' => $ids, 'run' => array( $this, 'edit' ) ),
			'updateWo' => array( 'ids' => $ids, 'validate' => array( $this, 'check_update' ), 'run' => array( $this, 'update' ) ),
			'openWo'   => array( 'ids' => $ids, 'run' => array( $this, 'open' ) ),
		);
	}

	/* ---------- helpers shared with Azl_Commands (assessWo, holdWo, completeWo) and Cleaning ---------- */

	/** A 'YYYY-MM-DD' date as epoch ms of midnight in the hotel's time zone, or null when it is not a real date. */
	public static function date_ms( $v ): ?int {
		if ( ! is_string( $v ) || ! preg_match( '/^(\d{4})-(\d{2})-(\d{2})\z/', $v, $m ) || ! checkdate( (int) $m[2], (int) $m[3], (int) $m[1] ) || (int) $m[1] < 2000 || (int) $m[1] > 2100 ) {
			return null;
		}
		return 1000 * ( new DateTimeImmutable( $v . ' 00:00:00', new DateTimeZone( self::TZ ) ) )->getTimestamp();
	}

	/** Epoch ms as the hotel's 'YYYY-MM-DD'. */
	public static function ms_date( int $ms ): string {
		return ( new DateTimeImmutable( '@' . intdiv( $ms, 1000 ) ) )->setTimezone( new DateTimeZone( self::TZ ) )->format( 'Y-m-d' );
	}

	/** An active staff member (of $dept when given). */
	public static function staff_ok( $id, ?string $dept = null ): bool {
		if ( ! Azl_Db::is_uuid( $id ) ) {
			return false;
		}
		$row = Azl_Db::row( 'SELECT dept FROM ' . Azl_Db::t( 'staff' ) . ' WHERE id = %s AND active = 1', array( strtolower( $id ) ) );
		return null !== $row && ( null === $dept || $row['dept'] === $dept );
	}

	public static function name_of( ?string $id ): string {
		$n = null === $id ? null : Azl_Db::val( 'SELECT name FROM ' . Azl_Db::t( 'staff' ) . ' WHERE id = %s', array( $id ) );
		return null === $n ? 'a manager' : $n;
	}

	public static function valid_cost( $n ): bool {
		return ( is_int( $n ) || is_float( $n ) ) && is_finite( (float) $n ) && $n >= 0 && $n < Azl_Commands::MAX_COST;
	}

	/**
	 * The hotel's lists, locked for the rest of the command (Azl_Catalog::locked), read once per command: a key cannot
	 * be removed while this command uses it. Lock order: the catalog first, before any work-order row.
	 */
	private $cat = null;
	private $cat_op = null;
	private function cat( ?string $op = null ): array {
		if ( null === $this->cat || $op !== $this->cat_op ) {
			$this->cat    = Azl_Catalog::locked();
			$this->cat_op = $op;
		}
		return $this->cat;
	}

	/** An active department key from the hotel's lists. */
	private function dept_ok( $key, ?string $op = null ): bool {
		return is_string( $key ) && null !== Azl_Catalog::active( $this->cat( $op ), 'departments', $key );
	}

	private function area_ok( string $area, ?string $op = null ): bool {
		foreach ( (array) ( $this->cat( $op )['woAreas'] ?? array() ) as $a ) {
			if ( ! empty( $a['active'] ) && ( $a['label'] ?? null ) === $area ) {
				return true;
			}
		}
		return false;
	}

	/** The row, locked for the rest of the command, or null. */
	public static function load( string $id ): ?array {
		return Azl_Db::row( 'SELECT * FROM ' . Azl_Db::t( 'work_orders' ) . ' WHERE id = %s' . Azl_Db::lock(), array( $id ) );
	}

	/** Why $type cannot run on a work order in $status, or null. */
	public static function refused( string $type, string $status ): ?string {
		$from = self::TRANSITIONS[ $type ][0] ?? array();
		return in_array( $status, $from, true ) ? null : 'Not possible while the work order is ' . str_replace( '_', ' ', $status );
	}

	/* ---------- reportWo ---------- */

	public function check_report( array $cmd ): ?string {
		$op = $cmd['opId'] ?? null;
		$area = Azl_Commands::line( $cmd['area'] ?? null );
		if ( '' === $area || ! $this->area_ok( $area, $op ) ) {
			return 'Choose the area.';
		}
		if ( mb_strlen( Azl_Commands::line( $cmd['loc'] ?? null ) ) > self::LOC_MAX ) {
			return 'Keep the location under ' . self::LOC_MAX . ' characters.';
		}
		$desc = Azl_Commands::para( $cmd['desc'] ?? null );
		if ( '' === $desc ) {
			return 'Description required.';
		}
		if ( mb_strlen( $desc ) > Azl_Commands::TEXT_MAX ) {
			return 'Keep the description under ' . Azl_Commands::TEXT_MAX . ' characters.';
		}
		if ( ! in_array( $cmd['priority'] ?? null, self::PRIORITIES, true ) ) {
			return 'Choose the priority.';
		}
		if ( ! $this->dept_ok( $cmd['dept'] ?? null, $op ) ) {
			return 'Choose the department to assign.';
		}
		if ( ! $this->dept_ok( $cmd['reporterDept'] ?? null, $op ) ) {
			return "Choose the reporter's department.";
		}
		if ( isset( $cmd['reporterId'] ) && ! self::staff_ok( $cmd['reporterId'], $cmd['reporterDept'] ) ) {
			return 'The reporter is not on the staff of that department.';
		}
		if ( isset( $cmd['encodedBy'] ) && ! self::staff_ok( $cmd['encodedBy'] ) ) {
			return 'Choose who encoded the work order.';
		}
		if ( null === self::date_ms( $cmd['requestedDate'] ?? null ) ) {
			return 'Date required.';
		}
		if ( isset( $cmd['schedDate'] ) && null === self::date_ms( $cmd['schedDate'] ) ) {
			return 'The scheduled date is not a valid date.';
		}
		if ( null !== Azl_Db::val( 'SELECT 1 FROM ' . Azl_Db::t( 'work_orders' ) . ' WHERE id = %s', array( $cmd['woId'] ) ) ) {
			return 'This work order already exists.';
		}
		return null;
	}

	public function report( array $cmd, Azl_Commands $ctx ): array {
		$reporter = isset( $cmd['reporterId'] ) ? strtolower( $cmd['reporterId'] ) : null;
		$encoder  = isset( $cmd['encodedBy'] ) ? strtolower( $cmd['encodedBy'] ) : $ctx->actor();
		$sched    = isset( $cmd['schedDate'] ) ? self::date_ms( $cmd['schedDate'] ) : null;
		$dept     = Azl_Catalog::find( $this->cat( $cmd['opId'] ?? null ), 'departments', $cmd['reporterDept'] );
		$label    = null === $sched
			? 'Reported by ' . ( null === $reporter ? 'staff' : self::name_of( $reporter ) ) . ' (' . ( $dept['label'] ?? $cmd['reporterDept'] ) . ')'
			: 'Scheduled for ' . self::ms_date( $sched );
		if ( ! $ctx->claim( 'work_order', $cmd['woId'], $label ) ) {
			return $ctx->replay( $cmd );
		}
		$n = Azl_Db::bump( 'wo' );
		Azl_Db::insert(
			'work_orders',
			array(
				'id'             => $cmd['woId'],
				'wo_no'          => $n,
				'area'           => Azl_Commands::line( $cmd['area'] ),
				'loc'            => Azl_Commands::line( $cmd['loc'] ?? '' ),
				'descr'          => Azl_Commands::para( $cmd['desc'] ),
				'priority'       => $cmd['priority'],
				'dept'           => $cmd['dept'],
				'status'         => null === $sched ? 'reported' : 'scheduled',
				'reported_by'    => $reporter,
				'encoded_by'     => $encoder,
				'reporter_dept'  => $cmd['reporterDept'],
				'requested_date' => self::date_ms( $cmd['requestedDate'] ),
				'sched_date'     => $sched,
				'op_id'          => $ctx->op(),
				'created_at'     => $ctx->now(),
				'updated_at'     => $ctx->now(),
			)
		);
		return Azl_Commands::ok( array( 'woNo' => $n ) );
	}

	/* ---------- editWo: any field the prototype's Edit has; only what changed ---------- */

	public function edit( array $cmd, Azl_Commands $ctx ): array {
		$op = $ctx->op();
		$this->cat( $op ); // lock the lists before the work order row
		$wo = self::load( $cmd['woId'] );
		if ( null === $wo ) {
			return Azl_Commands::fail( self::NOT_FOUND );
		}
		$set     = array();
		$changed = array();
		if ( array_key_exists( 'area', $cmd ) ) {
			$area = Azl_Commands::line( $cmd['area'] );
			if ( $area !== $wo['area'] ) {
				if ( '' === $area || ! $this->area_ok( $area, $op ) ) {
					return Azl_Commands::fail( 'Choose the area.' );
				}
				$set['area'] = $area;
				$changed[]   = 'area';
			}
		}
		if ( array_key_exists( 'loc', $cmd ) ) {
			$loc = Azl_Commands::line( $cmd['loc'] );
			if ( mb_strlen( $loc ) > self::LOC_MAX ) {
				return Azl_Commands::fail( 'Keep the location under ' . self::LOC_MAX . ' characters.' );
			}
			if ( $loc !== $wo['loc'] ) {
				$set['loc'] = $loc;
				$changed[]  = 'location';
			}
		}
		if ( array_key_exists( 'desc', $cmd ) ) {
			$desc = Azl_Commands::para( $cmd['desc'] );
			if ( '' === $desc || mb_strlen( $desc ) > Azl_Commands::TEXT_MAX ) {
				return Azl_Commands::fail( '' === $desc ? 'Description required.' : 'Keep the description under ' . Azl_Commands::TEXT_MAX . ' characters.' );
			}
			if ( $desc !== $wo['descr'] ) {
				$set['descr'] = $desc;
				$changed[]    = 'description';
			}
		}
		if ( array_key_exists( 'priority', $cmd ) && $cmd['priority'] !== $wo['priority'] ) {
			if ( ! in_array( $cmd['priority'], self::PRIORITIES, true ) ) {
				return Azl_Commands::fail( 'Choose the priority.' );
			}
			$set['priority'] = $cmd['priority'];
			$changed[]       = 'priority';
		}
		if ( array_key_exists( 'dept', $cmd ) && $cmd['dept'] !== $wo['dept'] ) {
			if ( ! $this->dept_ok( $cmd['dept'], $op ) ) {
				return Azl_Commands::fail( 'Choose the department to assign.' );
			}
			$set['dept'] = $cmd['dept'];
			$changed[]   = 'department';
		}
		// assigneeId (a uuid) sets who is assigned; clearAssignee: true removes it (an id field cannot be empty).
		if ( array_key_exists( 'assigneeId', $cmd ) || true === ( $cmd['clearAssignee'] ?? null ) ) {
			$who = $cmd['assigneeId'] ?? null;
			if ( null !== $who && ! self::staff_ok( $who ) ) {
				return Azl_Commands::fail( 'Choose who is assigned.' );
			}
			if ( 'outsource' === $wo['assign_type'] && null !== $who ) {
				return Azl_Commands::fail( 'This work order is outsourced: change the contractor instead.' );
			}
			if ( $who !== $wo['assignee'] ) {
				$set['assignee'] = $who;
				$changed[]       = 'assigned';
			}
		}
		if ( array_key_exists( 'contractor', $cmd ) ) {
			$c = Azl_Commands::line( $cmd['contractor'] );
			if ( 'outsource' !== $wo['assign_type'] ) {
				return Azl_Commands::fail( 'Only an outsourced work order has a contractor.' );
			}
			if ( '' === $c || mb_strlen( $c ) > Azl_Commands::NAME_MAX ) {
				return Azl_Commands::fail( 'Contractor required.' );
			}
			if ( $c !== $wo['contractor'] ) {
				$set['contractor'] = $c;
				$changed[]         = 'contractor';
			}
		}
		if ( array_key_exists( 'requestedDate', $cmd ) ) {
			$d = '' === $cmd['requestedDate'] || null === $cmd['requestedDate'] ? null : self::date_ms( $cmd['requestedDate'] );
			if ( null === $d && null !== $cmd['requestedDate'] && '' !== $cmd['requestedDate'] ) {
				return Azl_Commands::fail( 'The requested date is not a valid date.' );
			}
			if ( $d !== ( null === $wo['requested_date'] ? null : (int) $wo['requested_date'] ) ) {
				$set['requested_date'] = $d;
				$changed[]             = 'requested date';
			}
		}
		if ( array() === $changed ) {
			return Azl_Commands::fail( 'Nothing to change.' );
		}
		if ( ! $ctx->claim( 'work_order', $wo['id'], 'Edited: ' . implode( ', ', $changed ) ) ) {
			return $ctx->replay( $cmd );
		}
		Azl_Db::update( 'work_orders', $set + array( 'updated_at' => $ctx->now() ), array( 'id' => $wo['id'] ) );
		return Azl_Commands::ok();
	}

	/* ---------- updateWo: a progress note, optionally extending the deadline or moving the job to a contractor ---------- */

	public function check_update( array $cmd ): ?string {
		$text = Azl_Commands::para( $cmd['text'] ?? null );
		if ( '' === $text ) {
			return 'Required.';
		}
		if ( mb_strlen( $text ) > 1500 ) {
			return 'Keep the update under 1500 characters.';
		}
		if ( isset( $cmd['byId'] ) && ! self::staff_ok( $cmd['byId'] ) ) {
			return 'Choose who gave the update.';
		}
		if ( isset( $cmd['newDeadline'] ) && null === self::date_ms( $cmd['newDeadline'] ) ) {
			return 'New deadline required.';
		}
		if ( mb_strlen( Azl_Commands::line( $cmd['extendReason'] ?? '' ) ) > self::REASON_MAX ) {
			return 'Keep the reason under ' . self::REASON_MAX . ' characters.';
		}
		if ( isset( $cmd['contractor'] ) ) {
			$c = Azl_Commands::line( $cmd['contractor'] );
			if ( '' === $c || mb_strlen( $c ) > Azl_Commands::NAME_MAX ) {
				return 'Contractor required.';
			}
		}
		if ( isset( $cmd['estCost'] ) && ! self::valid_cost( $cmd['estCost'] ) ) {
			return 'Enter a cost of zero or more';
		}
		return null;
	}

	public function update( array $cmd, Azl_Commands $ctx ): array {
		$wo = self::load( $cmd['woId'] );
		if ( null === $wo ) {
			return Azl_Commands::fail( self::NOT_FOUND );
		}
		$no = self::refused( 'updateWo', $wo['status'] );
		if ( null !== $no ) {
			return Azl_Commands::fail( $no );
		}
		$outsource = isset( $cmd['contractor'] );
		if ( $outsource && 'outsource' === $wo['assign_type'] ) {
			return Azl_Commands::fail( 'This work order is already outsourced.' );
		}
		$lines  = array( Azl_Commands::para( $cmd['text'] ) );
		$events = array();
		$set    = array( 'updated_at' => $ctx->now() );
		if ( isset( $cmd['newDeadline'] ) ) {
			$old    = $wo['target_end'] ?? $wo['requested_date'];
			$from   = null === $old ? 'none' : self::ms_date( (int) $old );
			$to     = self::ms_date( self::date_ms( $cmd['newDeadline'] ) );
			$reason = Azl_Commands::line( $cmd['extendReason'] ?? '' );
			$lines[]           = "Deadline: $from → $to" . ( '' === $reason ? '' : " ($reason)" );
			$events[]          = "Deadline extended: $from → $to";
			$set['target_end'] = self::date_ms( $cmd['newDeadline'] );
		}
		if ( $outsource ) {
			$c                  = Azl_Commands::line( $cmd['contractor'] );
			$lines[]            = "Outsourced: $c";
			$events[]           = "Outsourced: $c";
			$set['assign_type'] = 'outsource';
			$set['contractor']  = $c;
			$set['assignee']    = null;
			if ( isset( $cmd['estCost'] ) ) {
				$set['est_cost'] = sprintf( '%.2f', $cmd['estCost'] );
			}
		}
		if ( ! $ctx->claim( 'work_order', $wo['id'], 'Progress update' ) ) {
			return $ctx->replay( $cmd );
		}
		foreach ( $events as $e ) {
			$ctx->claim( 'work_order', $wo['id'], $e );
		}
		Azl_Db::update( 'work_orders', $set, array( 'id' => $wo['id'] ) );
		Azl_Updates::add( 'work_order', $wo['id'], implode( "\n", $lines ), isset( $cmd['byId'] ) ? strtolower( $cmd['byId'] ) : $ctx->actor(), $ctx->op(), $ctx->now() );
		return Azl_Commands::ok();
	}

	/* ---------- openWo: a scheduled (preventive) job becomes a reported one ---------- */

	public function open( array $cmd, Azl_Commands $ctx ): array {
		$wo = self::load( $cmd['woId'] );
		if ( null === $wo ) {
			return Azl_Commands::fail( self::NOT_FOUND );
		}
		$no = self::refused( 'openWo', $wo['status'] );
		if ( null !== $no ) {
			return Azl_Commands::fail( $no );
		}
		if ( ! $ctx->claim( 'work_order', $wo['id'], 'Opened' ) ) {
			return $ctx->replay( $cmd );
		}
		Azl_Db::update( 'work_orders', array( 'status' => 'reported', 'updated_at' => $ctx->now() ), array( 'id' => $wo['id'] ) );
		return Azl_Commands::ok();
	}
}

Azl_Modules::register( new Azl_Module_WorkOrders() );
