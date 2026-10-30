<?php
/**
 * Reminders (sidebar module 9): follow-ups for the help desk, optionally linked to a record (a request, work order,
 * inquiry, house-status log or crisis case). The client prototype's module (docs/MODULES-SPEC.md A.11).
 *
 * Table azl_reminders; no numbers. Commands: addReminder, doneReminder (the prototype has no edit and no undo).
 * assignee NULL means "All HD Staff" (every help-desk officer); otherwise a staff id. due_at is epoch ms (the hotel's
 * clock is decided by the desk: it shows Asia/Manila time). The link is a free reference: link_type is one of LINKS,
 * link_id a uuid, link_label the text shown ("T-0102"), resolved here for the records this plugin holds and kept as
 * given (short, sanitised) for the others. Nothing is joined on it.
 *
 * Who: owner, manager and supervisor see and change everything. A help-desk officer has "own": sees reminders
 * assigned to them or to All HD Staff, may add reminders for themselves or All HD Staff, and may finish only those.
 * Department staff have no access (Azl_Access).
 *
 * @package azl-ehd
 */

defined( 'ABSPATH' ) || exit;

final class Azl_Module_Reminders extends Azl_Module {

	/** Link type => table, number column and number prefix, for the records this plugin can look up. Others: no lookup. */
	const LINKS = array(
		'request'     => array( 'requests', 'ticket_no', 'T-' ),
		'workorder'   => array( 'work_orders', 'wo_no', 'WO-' ),
		'inquiry'     => array( 'inquiries', 'inq_no', 'I-' ),
		'housestatus' => array( null, null, 'HS-' ),
		'crisis'      => array( null, null, 'CR-' ),
	);
	/** Staff roles that can be assigned a reminder (the roles that can open the module). */
	const ASSIGNEES = array( 'hdo', 'supervisor', 'manager', 'owner' );
	const DESC_MAX  = 200;
	const LABEL_MAX = 60;
	/** The snapshot carries every pending reminder plus the ones finished in this many days. */
	const DONE_DAYS = 7;
	const CAP       = 500;
	/** due_at must be between 2000 and 2100. */
	const DUE_MIN = 946684800000;
	const DUE_MAX = 4102444800000;

	public function id(): string {
		return 'reminders';
	}

	public function version(): string {
		return '1';
	}

	public function schema() {
		return 'CREATE TABLE ' . Azl_Db::t( 'reminders' ) . " (
  id char(36) NOT NULL,
  descr varchar(200) NOT NULL,
  assignee char(36) DEFAULT NULL,
  due_at bigint(20) DEFAULT NULL,
  notes text DEFAULT NULL,
  status varchar(10) NOT NULL DEFAULT 'pending',
  link_type varchar(12) DEFAULT NULL,
  link_id char(36) DEFAULT NULL,
  link_label varchar(60) DEFAULT NULL,
  completed_at bigint(20) DEFAULT NULL,
  completed_by char(36) DEFAULT NULL,
  created_by char(36) DEFAULT NULL,
  op_id char(36) NOT NULL,
  created_at bigint(20) NOT NULL,
  updated_at bigint(20) NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY op_id (op_id),
  KEY status_due (status,due_at),
  KEY assignee_status (assignee,status),
  KEY status_completed (status,completed_at)
) " . Azl_Schema::table_options() . ';';
	}

	public function commands(): array {
		return array(
			'addReminder'  => array(
				'ids'      => array( 'reminderId' ),
				'validate' => array( $this, 'validate_add' ),
				'run'      => array( $this, 'add' ),
			),
			'doneReminder' => array(
				'ids' => array( 'reminderId' ),
				'run' => array( $this, 'done' ),
			),
		);
	}

	/* ---------- validation (before any write) ---------- */

	public function validate_add( array $cmd ): ?string {
		$desc = Azl_Commands::line( $cmd['desc'] ?? null );
		if ( '' === $desc ) {
			return 'Describe what needs following up';
		}
		if ( mb_strlen( $desc ) > self::DESC_MAX ) {
			return 'Keep the description under ' . self::DESC_MAX . ' characters';
		}
		$to = $cmd['assignee'] ?? null;
		if ( null !== $to && ( ! Azl_Db::is_uuid( $to ) || null === self::assignee_row( $to ) ) ) {
			return 'Choose someone from the help desk, or All HD Staff';
		}
		$due = $cmd['dueAt'] ?? null;
		if ( null !== $due && ( ! is_int( $due ) || $due < self::DUE_MIN || $due > self::DUE_MAX ) ) {
			return 'Choose a valid date and time';
		}
		if ( null !== ( $cmd['notes'] ?? null ) && mb_strlen( Azl_Commands::para( $cmd['notes'] ) ) > Azl_Commands::TEXT_MAX ) {
			return 'Keep the notes under ' . Azl_Commands::TEXT_MAX . ' characters';
		}
		$type = $cmd['linkType'] ?? null;
		if ( null !== $type && ( ! is_string( $type ) || ! isset( self::LINKS[ $type ] ) ) ) {
			return 'Choose what to link the reminder to, or None';
		}
		if ( ( null === $type ) !== ( ! isset( $cmd['linkId'] ) ) ) {
			return 'Choose the record to link, or None';
		}
		return null;
	}

	private static function assignee_row( $id ): ?string {
		$role = Azl_Db::val( 'SELECT role FROM ' . Azl_Db::t( 'staff' ) . ' WHERE id = %s AND active = 1', array( strtolower( (string) $id ) ) );
		return null !== $role && in_array( $role, self::ASSIGNEES, true ) ? $role : null;
	}

	/**
	 * The text for a link, or null when a record this plugin holds does not exist. Never trusts the client's label for
	 * a record it can look up.
	 */
	private static function link_label( string $type, string $id, $given ): ?string {
		list( $table, $col, $prefix ) = self::LINKS[ $type ];
		if ( null !== $table ) {
			$n = Azl_Db::val( "SELECT $col FROM " . Azl_Db::t( $table ) . ' WHERE id = %s', array( $id ) );
			return null === $n ? null : $prefix . Azl_Rules::pad( (int) $n );
		}
		$label = mb_substr( Azl_Commands::line( $given ), 0, self::LABEL_MAX );
		return '' === $label ? rtrim( $prefix, '-' ) : $label;
	}

	/* ---------- commands ---------- */

	/** A help-desk officer's own limit: reminders of theirs or of All HD Staff. */
	private static function others( Azl_Commands $ctx, ?string $assignee ): bool {
		return 'hdo' === ( $ctx->who()['kind'] ?? '' ) && null !== $assignee && $assignee !== $ctx->actor();
	}

	public function add( array $cmd, Azl_Commands $ctx ): array {
		$to = isset( $cmd['assignee'] ) ? strtolower( $cmd['assignee'] ) : null;
		if ( self::others( $ctx, $to ) ) {
			return Azl_Commands::fail( 'You can set reminders for yourself or for All HD Staff' );
		}
		$t = Azl_Db::t( 'reminders' );
		if ( null !== Azl_Db::val( "SELECT id FROM $t WHERE id = %s", array( $cmd['reminderId'] ) ) ) {
			return Azl_Commands::fail( 'This reminder was already added' );
		}
		$label = null;
		if ( isset( $cmd['linkType'] ) ) {
			$label = self::link_label( $cmd['linkType'], $cmd['linkId'], $cmd['linkLabel'] ?? null );
			if ( null === $label ) {
				return Azl_Commands::fail( 'That record was not found. Choose another, or None' );
			}
		}
		$notes = Azl_Commands::para( $cmd['notes'] ?? null );
		if ( ! $ctx->claim( 'reminder', $cmd['reminderId'], 'Added' ) ) {
			return $ctx->replay( $cmd );
		}
		Azl_Db::insert(
			'reminders',
			array(
				'id'         => $cmd['reminderId'],
				'descr'      => Azl_Commands::line( $cmd['desc'] ),
				'assignee'   => $to,
				'due_at'     => $cmd['dueAt'] ?? null,
				'notes'      => '' === $notes ? null : $notes,
				'status'     => 'pending',
				'link_type'  => isset( $cmd['linkType'] ) ? $cmd['linkType'] : null,
				'link_id'    => isset( $cmd['linkType'] ) ? $cmd['linkId'] : null,
				'link_label' => $label,
				'created_by' => $ctx->actor(),
				'op_id'      => $ctx->op(),
				'created_at' => $ctx->now(),
				'updated_at' => $ctx->now(),
			)
		);
		return Azl_Commands::ok();
	}

	public function done( array $cmd, Azl_Commands $ctx ): array {
		$row = Azl_Db::row( 'SELECT status, assignee FROM ' . Azl_Db::t( 'reminders' ) . ' WHERE id = %s' . Azl_Db::lock(), array( $cmd['reminderId'] ) );
		if ( null === $row ) {
			return Azl_Commands::fail( 'Unknown reminder' );
		}
		if ( self::others( $ctx, $row['assignee'] ) ) {
			return Azl_Commands::fail( 'You can finish reminders that are yours or for All HD Staff' );
		}
		if ( 'pending' !== $row['status'] ) {
			return Azl_Commands::fail( 'This reminder is already done' );
		}
		if ( ! $ctx->claim( 'reminder', $cmd['reminderId'], 'Done' ) ) {
			return $ctx->replay( $cmd );
		}
		Azl_Db::update(
			'reminders',
			array( 'status' => 'completed', 'completed_at' => $ctx->now(), 'completed_by' => $ctx->actor(), 'updated_at' => $ctx->now() ),
			array( 'id' => $cmd['reminderId'] )
		);
		return Azl_Commands::ok();
	}

	/* ---------- snapshot ---------- */

	/** The staff id of the reader, when it is a help-desk officer on a shared phone ($who['staff'], else the request's PIN token). */
	private static function viewer( array $who ): ?string {
		if ( isset( $who['staff'] ) && is_string( $who['staff'] ) ) {
			return strtolower( $who['staff'] );
		}
		$token = isset( $_SERVER['HTTP_X_AZL_ACTOR'] ) ? wp_unslash( $_SERVER['HTTP_X_AZL_ACTOR'] ) : '';
		if ( ! is_string( $token ) || '' === $token ) {
			return null;
		}
		$actor = Azl_Staff::actor_for( (int) get_current_user_id(), $token );
		return $actor['ok'] && is_string( $actor['staff'] ?? null ) ? strtolower( $actor['staff'] ) : null;
	}

	/**
	 * { list: pending first (soonest due first, undated last), then those finished in the last 7 days; counts: pending
	 * }. A help-desk officer gets only their own and All HD Staff's.
	 */
	public function snapshot( array $who ): array {
		$t     = Azl_Db::t( 'reminders' );
		$scope = '';
		$args  = array();
		if ( 'hdo' === ( $who['kind'] ?? '' ) ) {
			$me    = self::viewer( $who );
			$scope = null === $me ? ' AND assignee IS NULL' : ' AND (assignee IS NULL OR assignee = %s)';
			$args  = null === $me ? array() : array( $me );
		}
		$cols    = 'id, descr, assignee, due_at, notes, status, link_type, link_id, link_label, completed_at, completed_by, created_by, created_at';
		$pending = Azl_Db::rows( "SELECT $cols FROM $t WHERE status = 'pending'$scope ORDER BY due_at IS NULL, due_at, created_at, id LIMIT %d", array_merge( $args, array( self::CAP ) ) );
		$done    = Azl_Db::rows(
			"SELECT $cols FROM $t WHERE status = 'completed' AND completed_at > %d$scope ORDER BY completed_at DESC, id LIMIT %d",
			array_merge( array( Azl_Db::now() - self::DONE_DAYS * 86400000 ), $args, array( 100 ) )
		);
		$n       = (int) Azl_Db::val( "SELECT COUNT(*) FROM $t WHERE status = 'pending'$scope", $args );
		$list    = array();
		foreach ( array_merge( $pending, $done ) as $r ) {
			$list[] = array_filter(
				array(
					'id'          => $r['id'],
					'desc'        => $r['descr'],
					'assignee'    => $r['assignee'],
					'dueAt'       => null === $r['due_at'] ? null : (int) $r['due_at'],
					'notes'       => $r['notes'],
					'status'      => $r['status'],
					'link'        => null === $r['link_type'] ? null : array( 'type' => $r['link_type'], 'id' => $r['link_id'], 'label' => $r['link_label'] ),
					'completedAt' => null === $r['completed_at'] ? null : (int) $r['completed_at'],
					'completedBy' => $r['completed_by'],
					'createdBy'   => $r['created_by'],
					'createdAt'   => (int) $r['created_at'],
				),
				static function ( $v ) {
					return null !== $v;
				}
			);
		}
		return array( 'list' => $list, 'counts' => array( 'pending' => $n ) );
	}
}

Azl_Modules::register( new Azl_Module_Reminders() );
