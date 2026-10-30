<?php
/**
 * Port of src/server/mutations.ts: applies one Command from src/server/contract.ts.
 *
 * Each command runs in one transaction:
 *   0. check the actor may change the command's module (Azl_Access, the role matrix);
 *   1. read and validate, with row locks on the rows it will change (no writes yet);
 *   2. claim the op by inserting its first event row (INSERT IGNORE on op_id + entity_id + what);
 *      nothing inserted means the op already ran: answer applied:false and stop;
 *   3. bump counters and write;
 *   4. bump the change counter that /poll reads, and commit.
 * A refusal ({ok:false}) or an exception rolls everything back. Error texts match the TypeScript.
 *
 * @package azl-ehd
 */

defined( 'ABSPATH' ) || exit;

final class Azl_Commands {

	const CLEAN_STATUSES  = array( 'scheduled', 'queued', 'ready', 'in_progress', 'done' );
	const FINISH_LABELS   = array(
		'done'      => 'Done',
		'cant_do'   => "Can't do",
		'duplicate' => 'Marked duplicate',
		'cancelled' => 'Cancelled',
	);
	const CLUSTER_MINUTES = 15;
	const MAX_COST        = 1e10; // decimal(12,2)
	const ALERT           = 'Safety words detected. Duty manager and Security alerted over the local network. Staff notified (not BFP/911).';
	const LOCKED_911      = 'The 911 call is already recorded for this incident';
	const ESCALATE_ONLY   = 'Only on-site items of a department that handles repairs can become work orders.';
	const NO_ITEM         = 'Unknown item';
	const NOTE_MAX        = 1000;
	const MAX_RETURN      = 500;
	const RETURNED        = 'Returned to department queue at shift end';
	const NOT_HERE        = 'You are not signed in at this property. Sign in with your PIN.';
	const ERROR           = 'Something went wrong. Try again.';
	const ROOM_MAX        = 40;
	const TEXT_MAX        = 2000;
	const NAME_MAX        = 120;

	/** Who asked (requests.source): a guest, or a staff member (named in staff_name). 'staff' is the value of every
	 * request logged before wave 2 (the desk logged them); it stays readable and is still what a command without a
	 * source stores. */
	const SOURCES       = array( 'guest', 'staff_request' );
	/** Roles that may be the help-desk officer (HDO) of a ticket. */
	const HDO_ROLES     = array( 'hdo', 'supervisor', 'manager', 'owner' );
	/** Target time of an "Other" item (not in the hotel's request types), from acknowledgement. */
	const OTHER_SLA_MIN = 30;
	const QTY_MAX       = 99;
	const ROWS_MAX      = 20;
	const ITEM_NOTE_MAX = 191;
	const REMARKS_MAX   = 500;
	/** Labels of the item steps that undoStep can take back (the newest one is the step undone). */
	const UNDOABLE      = array( 'Relayed', 'On site', 'On hold', 'Resumed', 'Done', "Can't do", 'Marked duplicate', 'Cancelled' );

	/** Id fields each command must carry (besides opId). */
	const REQUIRED_IDS = array(
		'logRequest'        => array( 'requestId' ),
		'completeRequest'   => array( 'requestId' ),
		'relay'             => array( 'itemId' ),
		'onSite'            => array( 'itemId' ),
		'resume'            => array( 'itemId' ),
		'hold'              => array( 'itemId' ),
		'finish'            => array( 'itemId' ),
		'transfer'          => array( 'itemId', 'newItemId' ),
		'escalate'          => array( 'itemId', 'woId' ),
		'undoEscalate'      => array( 'itemId' ),
		'assessWo'          => array( 'woId' ),
		'startWo'           => array( 'woId' ),
		'holdWo'            => array( 'woId' ),
		'reopenWo'          => array( 'woId' ),
		'completeWo'        => array( 'woId' ),
		'cleanSet'          => array( 'taskId' ),
		'raiseSafety'       => array( 'incidentId' ),
		'downgradeIncident' => array( 'incidentId' ),
		'resolveIncident'   => array( 'incidentId' ),
		'record911'         => array( 'incidentId' ),
		'ackHandover'       => array( 'handoverId' ),
		'returnOrphans'     => array(),
	);
	const ITEM_LISTS = array( 'logRequest', 'completeRequest', 'returnOrphans' );

	/** item step => [allowed from-statuses, event label]. */
	const ITEM_STEPS = array(
		'relay'  => array( array( 'new' ), 'Relayed' ),
		'onSite' => array( array( 'new', 'relayed' ), 'On site' ),
		'hold'   => array( array( 'relayed', 'on_site' ), 'On hold' ),
		'resume' => array( array( 'on_hold' ), 'Resumed' ),
	);

	/** work-order step => [allowed from-statuses, event label]. */
	const WO_STEPS = array(
		'assessWo'   => array( array( 'reported' ), 'Assessed' ),
		'startWo'    => array( array( 'assessed', 'on_hold' ), 'Work started' ),
		'holdWo'     => array( array( 'in_progress' ), 'Put on hold' ),
		'completeWo' => array( array( 'in_progress', 'on_hold', 'assessed' ), 'Completed' ),
		'reopenWo'   => array( array( 'done' ), 'Reopened' ),
	);

	/** @var string|null staff id acting, or null when a manager account acts directly */
	private $actor;
	/** @var string */
	private $op;
	/** @var int one time for the whole command, like now() in one Postgres transaction */
	private $now;
	/** @var array|null the actor kind and department (Azl_Access::who), or null to read it from the signed-in user */
	private $who;

	private function __construct( ?string $actor, string $op, ?array $who ) {
		$this->actor = $actor;
		$this->op    = $op;
		$this->now   = Azl_Db::now();
		$this->who   = $who;
	}

	/**
	 * Applies one command. $cmd is the decoded JSON body; $actor is the staff id acting (from the PIN
	 * token or the manager's linked staff row) or null for a manager account with no staff row.
	 * $who is the actor kind (Azl_Access::who); by default it comes from the signed-in WordPress user and $actor.
	 *
	 * @return array The CommandResult: {ok:true, applied, ticketNo?, woNo?, incidentNo?, clusteredInto?} or {ok:false, error}.
	 */
	public static function apply( array $cmd, ?string $actor, ?array $who = null ): array {
		$cmd = self::normalized( $cmd, $actor );
		if ( null === $cmd ) {
			return self::fail( 'Invalid id' );
		}
		if ( null !== $actor ) {
			$actor = strtolower( $actor );
		}
		try {
			return Azl_Db::transaction(
				function () use ( $cmd, $actor, $who ) {
					$r      = ( new self( $actor, $cmd['opId'], $who ) )->run( $cmd );
					$commit = true === $r['ok'] && true === $r['applied'];
					if ( $commit ) {
						Azl_Db::bump( 'change' );
					}
					return array( $commit, $r );
				}
			);
		} catch ( Throwable $e ) {
			error_log( 'azl-ehd command ' . ( is_string( $cmd['type'] ?? null ) ? $cmd['type'] : '?' ) . ' failed: ' . $e->getMessage() );
			return self::fail( self::ERROR );
		}
	}

	/** Checks every id is a uuid and lower-cases them. Null when one is missing or malformed. */
	private static function normalized( array $cmd, ?string $actor ): ?array {
		if ( null !== $actor && ! Azl_Db::is_uuid( $actor ) ) {
			return null;
		}
		if ( ! Azl_Db::is_uuid( $cmd['opId'] ?? null ) ) {
			return null;
		}
		$type     = is_string( $cmd['type'] ?? null ) ? $cmd['type'] : '';
		$required = self::REQUIRED_IDS[ $type ] ?? ( class_exists( 'Azl_Modules' ) ? ( Azl_Modules::command( $type )['ids'] ?? array() ) : array() );
		foreach ( $required as $k ) {
			if ( ! array_key_exists( $k, $cmd ) ) {
				return null;
			}
		}
		if ( in_array( $type, self::ITEM_LISTS, true ) && ! array_key_exists( 'itemIds', $cmd ) ) {
			return null;
		}
		foreach ( $cmd as $k => $v ) {
			if ( ! is_string( $k ) ) {
				return null;
			}
			if ( 'Id' === substr( $k, -2 ) ) {
				if ( ! Azl_Db::is_uuid( $v ) ) {
					return null;
				}
				$cmd[ $k ] = strtolower( $v );
			}
			if ( 'itemIds' === $k ) {
				if ( ! is_array( $v ) || ! array_is_list( $v ) ) {
					return null;
				}
				foreach ( $v as $i => $one ) {
					if ( ! Azl_Db::is_uuid( $one ) ) {
						return null;
					}
					$cmd['itemIds'][ $i ] = strtolower( $one );
				}
			}
		}
		return $cmd;
	}

	private function run( array $cmd ): array {
		if ( null !== $this->actor ) {
			$here = Azl_Db::val( 'SELECT 1 FROM ' . Azl_Db::t( 'staff' ) . ' WHERE id = %s AND active = 1', array( $this->actor ) );
			if ( null === $here ) {
				return self::fail( self::NOT_HERE );
			}
		}
		// The role matrix (Azl_Access): every command belongs to a module; too little access is refused here.
		$this->who = $this->who ?? Azl_Access::who( (int) get_current_user_id(), $this->actor );
		$refused   = Azl_Access::refusal( $cmd, $this->who );
		if ( null !== $refused ) {
			return self::fail( $refused );
		}
		return $this->prior( $cmd ) ?? $this->dispatch( $cmd );
	}

	/** A command of a module (Azl_Modules): its validation, then its handler with this command as context. */
	private function module_command( array $cmd ): array {
		$def = Azl_Modules::command( (string) $cmd['type'] );
		if ( null === $def ) {
			return self::fail( 'Unknown command' );
		}
		$problem = isset( $def['validate'] ) ? ( $def['validate'] )( $cmd ) : null;
		if ( is_string( $problem ) && '' !== $problem ) {
			return self::fail( $problem );
		}
		$r = ( $def['run'] )( $cmd, $this );
		return is_array( $r ) && is_bool( $r['ok'] ?? null ) ? $r : self::fail( self::ERROR );
	}

	/* ---------- the context a module command runs in ---------- */

	/** The staff id acting, or null for a manager account acting as itself. */
	public function actor(): ?string {
		return $this->actor;
	}

	/** The command's op id (store it in the row's op_id column). */
	public function op(): string {
		return $this->op;
	}

	/** The command's one clock, epoch ms. */
	public function now(): int {
		return $this->now;
	}

	/** The actor kind and department (Azl_Access::who). */
	public function who(): array {
		return $this->who ?? array( 'kind' => 'none', 'dept' => null );
	}

	/**
	 * Writes a history row. The first call of a command is its claim: false means this op already ran, and the
	 * handler must stop and return replay(). Later calls add more history to the same op.
	 */
	public function claim( string $entity, string $entity_id, string $what ): bool {
		return $this->event( $entity, $entity_id, $what );
	}

	/** The answer for an op that already ran (a concurrent copy committed first). */
	public function replay( array $cmd ): array {
		return $this->replayed( $cmd );
	}

	private function dispatch( array $cmd ): array {
		switch ( $cmd['type'] ?? null ) {
			case 'logRequest':
				return $this->log_request( $cmd );
			case 'completeRequest':
				return $this->complete_request( $cmd );
			case 'relay':
			case 'onSite':
			case 'resume':
				return $this->step_item( $cmd );
			case 'hold':
				// Only an active reason; items already held keep an archived one.
				return null !== Azl_Catalog::active( Azl_Catalog::locked(), 'holdReasons', $cmd['reason'] ?? null )
					? $this->step_item( $cmd )
					: self::fail( 'Unknown hold reason' );
			case 'finish':
				return $this->finish( $cmd );
			case 'transfer':
				return $this->transfer( $cmd );
			case 'escalate':
				return $this->escalate( $cmd );
			case 'undoEscalate':
				return $this->undo_escalate( $cmd );
			case 'assessWo':
				return $this->assess_wo( $cmd );
			case 'startWo':
			case 'holdWo':
			case 'reopenWo':
				return $this->step_wo( $cmd, array() );
			case 'completeWo':
				return self::valid_cost( $cmd['actualCost'] ?? null )
					? $this->step_wo( $cmd, array( 'actual_cost' => sprintf( '%.2f', $cmd['actualCost'] ) ) )
					: self::fail( 'Enter a cost of zero or more' );
			case 'cleanSet':
				return $this->clean_set( $cmd );
			case 'raiseSafety':
				return $this->raise_safety( $cmd );
			case 'downgradeIncident':
			case 'resolveIncident':
				return $this->set_incident_status( $cmd );
			case 'record911':
				return $this->record_911( $cmd );
			case 'ackHandover':
				return $this->ack_handover( $cmd );
			case 'returnOrphans':
				return $this->return_orphans( $cmd );
			default:
				return $this->module_command( $cmd );
		}
	}

	/* ---------- helpers (public: module commands answer the same way) ---------- */

	public static function fail( string $error ): array {
		return array( 'ok' => false, 'error' => $error );
	}

	public static function ok( array $extra = array() ): array {
		return array_merge( array( 'ok' => true, 'applied' => true ), $extra );
	}

	/** A one-line text field: sanitised and trimmed, or '' when not a string. */
	public static function line( $v ): string {
		return is_string( $v ) ? trim( sanitize_text_field( $v ) ) : '';
	}

	/** A multi-line text field: sanitised and trimmed, or '' when not a string. */
	public static function para( $v ): string {
		return is_string( $v ) ? trim( sanitize_textarea_field( $v ) ) : '';
	}

	private static function valid_cost( $n ): bool {
		return ( is_int( $n ) || is_float( $n ) ) && is_finite( (float) $n ) && $n >= 0 && $n < self::MAX_COST;
	}

	private static function not_now( string $what, string $status ): string {
		return "Not possible while the $what is " . preg_replace( '/_/', ' ', $status, 1 );
	}

	/* ---------- idempotency ---------- */

	/** The result to return when this op already ran, or null when it has not. */
	private function prior( array $cmd ): ?array {
		$entity_id = Azl_Db::val( 'SELECT entity_id FROM ' . Azl_Db::t( 'events' ) . ' WHERE op_id = %s ORDER BY id LIMIT 1', array( $this->op ) );
		return null === $entity_id ? null : array_merge( array( 'ok' => true, 'applied' => false ), $this->prior_numbers( $cmd, $entity_id ) );
	}

	private function prior_numbers( array $cmd, string $entity_id ): array {
		$type = $cmd['type'] ?? '';
		if ( 'logRequest' === $type ) {
			$n = Azl_Db::val( 'SELECT ticket_no FROM ' . Azl_Db::t( 'requests' ) . ' WHERE id = %s', array( $entity_id ) );
			return null === $n ? array() : array( 'ticketNo' => (int) $n );
		}
		if ( 'escalate' === $type ) {
			$n = Azl_Db::val( 'SELECT wo_no FROM ' . Azl_Db::t( 'work_orders' ) . ' WHERE id = %s', array( $entity_id ) );
			return null === $n ? array() : array( 'woNo' => (int) $n );
		}
		if ( 'raiseSafety' === $type ) {
			$x = Azl_Db::row( 'SELECT inc_no, op_id FROM ' . Azl_Db::t( 'incidents' ) . ' WHERE id = %s', array( $entity_id ) );
			if ( null !== $x && $x['op_id'] === $this->op ) {
				return array( 'incidentNo' => (int) $x['inc_no'] );
			}
			return null === $x ? array( 'clusteredInto' => $entity_id ) : array( 'incidentNo' => (int) $x['inc_no'], 'clusteredInto' => $entity_id );
		}
		$def = is_string( $type ) && ! isset( self::REQUIRED_IDS[ $type ] ) ? Azl_Modules::command( $type ) : null;
		if ( null !== $def && isset( $def['prior'] ) ) {
			$extra = ( $def['prior'] )( $entity_id );
			return is_array( $extra ) ? $extra : array();
		}
		return array();
	}

	/** Appends a history row. As the first write of a command it is the claim: false means the op already ran. */
	private function event( string $entity, string $entity_id, string $what ): bool {
		$sql = Azl_Db::insert_ignore() . ' INTO ' . Azl_Db::t( 'events' )
			. ' (entity, entity_id, what, by_staff, op_id, created_at) VALUES (%s, %s, %s, ' . Azl_Db::literal( $this->actor ) . ', %s, %d)';
		return Azl_Db::exec( $sql, array( $entity, $entity_id, mb_substr( $what, 0, 191 ), $this->op, $this->now ) ) > 0;
	}

	/** A concurrent copy of this op committed between our check and our claim. */
	private function replayed( array $cmd ): array {
		return $this->prior( $cmd ) ?? array( 'ok' => true, 'applied' => false );
	}

	/* ---------- requests ---------- */

	/**
	 * The hotel's active request types, copied into the items (name, department, SLA): later edits to
	 * the list never change a logged item.
	 *
	 * @return array|null list of [name, dept, slaMin, after|null], or null for an unknown or archived key
	 */
	private static function preset_specs( array $cat, $keys ): ?array {
		if ( ! is_array( $keys ) || ! array_is_list( $keys ) ) {
			return null;
		}
		$out = array();
		foreach ( $keys as $k ) {
			$p = Azl_Catalog::active( $cat, 'requestTypes', $k );
			if ( null === $p ) {
				return null;
			}
			$out[] = array( $p['label'], $p['dept'], $p['slaMin'], null );
		}
		return $out;
	}

	/** An active bundle's parts. $offset is where they start in the request's item list. */
	private static function bundle_specs( array $cat, $key, int $offset ): ?array {
		if ( null === $key ) {
			return array();
		}
		$b = Azl_Catalog::active( $cat, 'bundles', $key );
		if ( null === $b ) {
			return null;
		}
		$out = array();
		foreach ( $b['parts'] as $p ) {
			$out[] = array( $p['name'], $p['dept'], $p['slaMin'], isset( $p['after'] ) ? $offset + $p['after'] : null );
		}
		return $out;
	}

	private static function ids_match( array $ids, int $n ): bool {
		return count( $ids ) === $n && count( array_unique( $ids ) ) === $n;
	}

	/** An active staff member's department, or false when the id is not an active staff member. */
	private static function staff_dept( $id ) {
		if ( ! Azl_Db::is_uuid( $id ) ) {
			return false;
		}
		$row = Azl_Db::row( 'SELECT dept FROM ' . Azl_Db::t( 'staff' ) . ' WHERE id = %s AND active = 1', array( strtolower( $id ) ) );
		return null === $row ? false : $row['dept'];
	}

	/** The person someone is assigning: null for "nobody", the lower-case id, or false when not someone of $dept. */
	private static function assignee_for( $id, string $dept ) {
		if ( null === $id || '' === $id ) {
			return null;
		}
		return self::staff_dept( $id ) === $dept ? strtolower( $id ) : false;
	}

	/**
	 * The New Request rows (the prototype's item rows): each { type: request type key } or { other: text, dept },
	 * with optional qty (1-99) and assignee (someone of that department). Validated in full before any write.
	 *
	 * @return array|string specs like preset_specs() plus qty and assignee, or a plain-language refusal
	 */
	private static function row_specs( array $cat, $rows ) {
		if ( ! is_array( $rows ) || ! array_is_list( $rows ) || count( $rows ) > self::ROWS_MAX ) {
			return 'Add up to ' . self::ROWS_MAX . ' items';
		}
		$out = array();
		foreach ( $rows as $r ) {
			if ( ! is_array( $r ) ) {
				return 'Unknown request type';
			}
			if ( isset( $r['type'] ) ) {
				$p = Azl_Catalog::active( $cat, 'requestTypes', $r['type'] );
				if ( null === $p ) {
					return 'Unknown request type';
				}
				$spec = array( $p['label'], $p['dept'], $p['slaMin'], null );
			} else {
				$name = self::line( $r['other'] ?? null );
				if ( '' === $name ) {
					return 'Describe the item';
				}
				if ( mb_strlen( $name ) > self::NAME_MAX ) {
					return 'Keep the item under ' . self::NAME_MAX . ' characters';
				}
				if ( null === Azl_Catalog::active( $cat, 'departments', $r['dept'] ?? null ) ) {
					return 'Choose a department for the item';
				}
				$spec = array( $name, $r['dept'], self::OTHER_SLA_MIN, null );
			}
			$qty = $r['qty'] ?? 1;
			if ( ! is_int( $qty ) || $qty < 1 || $qty > self::QTY_MAX ) {
				return 'Quantity must be 1 to ' . self::QTY_MAX;
			}
			$who = self::assignee_for( $r['assignee'] ?? null, $spec[1] );
			if ( false === $who ) {
				return "Assign someone from the item's department";
			}
			$spec[] = $qty;
			$spec[] = $who;
			$out[]  = $spec;
		}
		return $out;
	}

	/** Who asked: [source, staff name] or a refusal. No source keeps the pre-wave-2 value 'staff'. */
	private static function source_of( array $cmd ) {
		if ( ! array_key_exists( 'source', $cmd ) ) {
			return array( 'staff', null );
		}
		if ( ! in_array( $cmd['source'], self::SOURCES, true ) ) {
			return 'Unknown source';
		}
		if ( 'guest' === $cmd['source'] ) {
			return array( 'guest', null );
		}
		$name = self::line( $cmd['staffName'] ?? null );
		if ( '' === $name ) {
			return "Enter the staff member's name";
		}
		return mb_strlen( $name ) > self::NAME_MAX ? 'Keep the name under ' . self::NAME_MAX . ' characters' : array( 'staff_request', $name );
	}

	/** True when this id is an active staff member who may be a ticket's help-desk officer. */
	private static function valid_hdo( string $id ): bool {
		$role = Azl_Db::val( 'SELECT role FROM ' . Azl_Db::t( 'staff' ) . ' WHERE id = %s AND active = 1', array( $id ) );
		return in_array( $role, self::HDO_ROLES, true );
	}

	private function insert_items( string $request_id, array $specs, array $ids, string $label, int $first_pos ): void {
		foreach ( $specs as $i => $s ) {
			Azl_Db::insert(
				'items',
				array(
					'id'         => $ids[ $i ],
					'request_id' => $request_id,
					'pos'        => $first_pos + $i,
					'name'       => $s[0],
					'qty'        => $s[4] ?? 1,
					'dept'       => $s[1],
					'assignee'   => $s[5] ?? null,
					'status'     => 'new',
					'sla_min'    => $s[2],
					'held_ms'    => 0,
					'depends_on' => null === $s[3] ? null : $ids[ $s[3] ],
					'created_at' => $this->now,
					'updated_at' => $this->now,
				)
			);
			$this->event( 'item', $ids[ $i ], $label );
		}
	}

	/** The items of a new or completed request: rows (New Request) or presets, never both. Specs or a refusal. */
	private static function item_specs( array $cat, array $cmd ) {
		if ( array_key_exists( 'rows', $cmd ) ) {
			return array() !== ( $cmd['presets'] ?? array() ) ? 'Send rows or presets, not both' : self::row_specs( $cat, $cmd['rows'] );
		}
		return self::preset_specs( $cat, $cmd['presets'] ?? array() ) ?? 'Unknown request type';
	}

	private function log_request( array $cmd ): array {
		$room = self::line( $cmd['room'] ?? null );
		if ( '' === $room ) {
			return self::fail( 'Room is required' );
		}
		if ( mb_strlen( $room ) > self::ROOM_MAX ) {
			return self::fail( 'Keep the room under ' . self::ROOM_MAX . ' characters' );
		}
		$cat   = Azl_Catalog::locked();
		$rows  = self::item_specs( $cat, $cmd );
		$parts = is_array( $rows ) ? self::bundle_specs( $cat, $cmd['bundle'] ?? null, count( $rows ) ) : array();
		if ( is_string( $rows ) ) {
			return self::fail( $rows );
		}
		if ( null === $parts ) {
			return self::fail( 'Unknown request type' );
		}
		$specs = array_merge( $rows, $parts );
		if ( ! self::ids_match( $cmd['itemIds'], count( $specs ) ) ) {
			return self::fail( 'Item ids do not match the items' );
		}
		$remarks = is_string( $cmd['remarks'] ?? null ) ? self::para( $cmd['remarks'] ) : null;
		if ( null !== $remarks && mb_strlen( $remarks ) > self::TEXT_MAX ) {
			return self::fail( 'Keep the remarks under ' . self::TEXT_MAX . ' characters' );
		}
		$source = self::source_of( $cmd );
		if ( is_string( $source ) ) {
			return self::fail( $source );
		}
		// The HDO defaults to the person logging it (none for a manager account acting as itself).
		$hdo = $cmd['hdoId'] ?? $this->actor;
		if ( isset( $cmd['hdoId'] ) && ! self::valid_hdo( $hdo ) ) {
			return self::fail( 'Choose a help-desk officer from the list' );
		}
		if ( ! $this->event( 'request', $cmd['requestId'], 'Logged' ) ) {
			return $this->replayed( $cmd );
		}
		$n = Azl_Db::bump( 'ticket' );
		Azl_Db::insert(
			'requests',
			array(
				'id'         => $cmd['requestId'],
				'ticket_no'  => $n,
				'room'       => $room,
				'source'     => $source[0],
				'staff_name' => $source[1],
				'hdo'        => $hdo,
				'remarks'    => $remarks,
				'logged_by'  => $this->actor,
				'vip'        => true === ( $cmd['vip'] ?? null ) ? 1 : 0,
				'incomplete' => ( true === ( $cmd['later'] ?? null ) || 0 === count( $specs ) ) ? 1 : 0,
				'op_id'      => $this->op,
				'created_at' => $this->now,
				'updated_at' => $this->now,
			)
		);
		$this->insert_items( $cmd['requestId'], $specs, $cmd['itemIds'], 'Logged', 0 );
		return self::ok( array( 'ticketNo' => $n ) );
	}

	private function complete_request( array $cmd ): array {
		$cat = Azl_Catalog::locked();
		$req = Azl_Db::row( 'SELECT incomplete FROM ' . Azl_Db::t( 'requests' ) . ' WHERE id = %s' . Azl_Db::lock(), array( $cmd['requestId'] ) );
		if ( null === $req ) {
			return self::fail( 'Unknown request' );
		}
		if ( '1' !== (string) $req['incomplete'] ) {
			return self::fail( 'This request already has its details' );
		}
		if ( ! array_key_exists( 'rows', $cmd ) && ! array_key_exists( 'presets', $cmd ) ) {
			return self::fail( 'Unknown request type' );
		}
		$specs = self::item_specs( $cat, $cmd );
		if ( is_string( $specs ) ) {
			return self::fail( $specs );
		}
		if ( ! self::ids_match( $cmd['itemIds'], count( $specs ) ) ) {
			return self::fail( 'Item ids do not match the items' );
		}
		if ( ! $this->event( 'request', $cmd['requestId'], 'Details added' ) ) {
			return $this->replayed( $cmd );
		}
		$have = (int) Azl_Db::val( 'SELECT COUNT(*) FROM ' . Azl_Db::t( 'items' ) . ' WHERE request_id = %s', array( $cmd['requestId'] ) );
		$this->insert_items( $cmd['requestId'], $specs, $cmd['itemIds'], 'Details added', $have );
		Azl_Db::update( 'requests', array( 'incomplete' => 0, 'updated_at' => $this->now ), array( 'id' => $cmd['requestId'] ) );
		return self::ok();
	}

	/* ---------- items ---------- */

	private function load_item( string $id ): ?array {
		return Azl_Db::row( 'SELECT * FROM ' . Azl_Db::t( 'items' ) . ' WHERE id = %s' . Azl_Db::lock(), array( $id ) );
	}

	private static function is_open( array $it ): bool {
		return in_array( $it['status'], Azl_Rules::OPEN_STATUSES, true );
	}

	/** The client's firstOf(): the first on-shift staff member of the department. */
	private function first_on_shift( string $dept ): ?string {
		return Azl_Db::val(
			'SELECT id FROM ' . Azl_Db::t( 'staff' ) . " WHERE dept = %s AND on_shift = 1 AND active = 1 AND role = 'staff' ORDER BY created_at, id LIMIT 1",
			array( $dept )
		);
	}

	/** Milliseconds an item has been on hold right now. */
	private function held_now( array $it ): int {
		return 'on_hold' === $it['status'] && null !== $it['hold_since'] ? max( 0, $this->now - (int) $it['hold_since'] ) : 0;
	}

	private function step_item( array $cmd ): array {
		list( $from, $label ) = self::ITEM_STEPS[ $cmd['type'] ];
		$it                   = $this->load_item( $cmd['itemId'] );
		if ( null === $it ) {
			return self::fail( self::NO_ITEM );
		}
		if ( ! in_array( $it['status'], $from, true ) ) {
			return self::fail( self::not_now( 'item', $it['status'] ) );
		}
		if ( ! $this->event( 'item', $it['id'], $label ) ) {
			return $this->replayed( $cmd );
		}
		$ack = null === $it['ack_at'] ? $this->now : (int) $it['ack_at'];
		switch ( $cmd['type'] ) {
			case 'relay':
				$data = array( 'status' => 'relayed', 'ack_at' => $this->now, 'relayed_by' => $this->actor, 'assignee' => $it['assignee'] ?? $this->first_on_shift( $it['dept'] ) );
				break;
			case 'onSite':
				$data = array( 'status' => 'on_site', 'ack_at' => $ack, 'on_site_at' => $this->now, 'assignee' => $it['assignee'] ?? $this->first_on_shift( $it['dept'] ) );
				break;
			case 'hold':
				$data = array( 'status' => 'on_hold', 'hold_reason' => $cmd['reason'], 'hold_since' => $this->now, 'ack_at' => $ack );
				break;
			default: // resume: the hold clock stops and its time is kept off the SLA.
				$data = array(
					'status'      => 'on_site',
					'held_ms'     => (int) $it['held_ms'] + $this->held_now( $it ),
					'hold_since'  => null,
					'hold_reason' => null,
				);
		}
		$data['prev_status'] = $it['status']; // what undoStep goes back to
		$data['updated_at']  = $this->now;
		Azl_Db::update( 'items', $data, array( 'id' => $it['id'] ) );
		return self::ok();
	}

	/** The client's closeItem(): close, stop any hold clock, and ready the room after a checkout or inspection. */
	private function close_item( array $it, string $status ): void {
		Azl_Db::update(
			'items',
			array(
				'prev_status' => $it['status'],
				'status'      => $status,
				'done_at'     => $this->now,
				'ack_at'      => null === $it['ack_at'] ? $this->now : (int) $it['ack_at'],
				'held_ms'     => (int) $it['held_ms'] + $this->held_now( $it ),
				'hold_since'  => null,
				'hold_reason' => null,
				'updated_at'  => $this->now,
			),
			array( 'id' => $it['id'] )
		);
		if ( 'done' !== $status || ! preg_match( '/checkout|inspection/i', $it['name'] ) ) {
			return;
		}
		$ct = Azl_Db::t( 'clean_tasks' );
		Azl_Db::exec(
			"UPDATE $ct SET status = 'ready', updated_at = %d WHERE status IN ('scheduled', 'queued') AND room = (SELECT room FROM "
				. Azl_Db::t( 'requests' ) . ' WHERE id = %s)',
			array( $this->now, $it['request_id'] )
		);
	}

	private function blocked( array $it ): bool {
		if ( null === $it['depends_on'] ) {
			return false;
		}
		$pre = Azl_Db::val( 'SELECT status FROM ' . Azl_Db::t( 'items' ) . ' WHERE id = %s', array( $it['depends_on'] ) );
		return 'done' !== $pre;
	}

	private function finish( array $cmd ): array {
		$status = $cmd['status'] ?? null;
		if ( ! is_string( $status ) || ! isset( self::FINISH_LABELS[ $status ] ) ) {
			return self::fail( 'Unknown status' );
		}
		$it = $this->load_item( $cmd['itemId'] );
		if ( null === $it ) {
			return self::fail( self::NO_ITEM );
		}
		if ( ! self::is_open( $it ) ) {
			return self::fail( self::not_now( 'item', $it['status'] ) );
		}
		if ( $this->blocked( $it ) ) {
			return self::fail( 'Waiting for the earlier step to finish first.' );
		}
		if ( ! $this->event( 'item', $it['id'], self::FINISH_LABELS[ $status ] ) ) {
			return $this->replayed( $cmd );
		}
		$this->close_item( $it, $status );
		return self::ok();
	}

	private function transfer( array $cmd ): array {
		$dept = $cmd['dept'] ?? null;
		if ( null === Azl_Catalog::active( Azl_Catalog::locked(), 'departments', $dept ) ) {
			return self::fail( 'Unknown department' ); // or archived: no new work goes there
		}
		$it = $this->load_item( $cmd['itemId'] );
		if ( null === $it ) {
			return self::fail( self::NO_ITEM );
		}
		if ( ! self::is_open( $it ) ) {
			return self::fail( self::not_now( 'item', $it['status'] ) );
		}
		if ( $it['dept'] === $dept ) {
			return self::fail( 'The item is already with that department' );
		}
		$note = self::note_of( $cmd );
		$who  = self::assignee_for( $cmd['assignee'] ?? null, $dept );
		if ( null === $note || false === $who ) {
			return self::fail( null === $note ? 'Keep the reason under ' . self::ITEM_NOTE_MAX . ' characters' : 'Assign someone from that department' );
		}
		if ( ! $this->event( 'item', $it['id'], "Transferred to $dept" ) ) {
			return $this->replayed( $cmd );
		}
		Azl_Db::update( 'items', array( 'status' => 'transferred', 'prev_status' => $it['status'], 'done_at' => $this->now, 'updated_at' => $this->now ), array( 'id' => $it['id'] ) );
		Azl_Db::insert(
			'items',
			array(
				'id'         => $cmd['newItemId'],
				'request_id' => $it['request_id'],
				'pos'        => (int) $it['pos'],
				'name'       => $it['name'],
				'qty'        => (int) $it['qty'],
				'dept'       => $dept,
				'assignee'   => $who,
				'status'     => 'new',
				'sla_min'    => (int) $it['sla_min'],
				'held_ms'    => 0,
				'depends_on' => $it['depends_on'],
				'x_from'     => $it['id'],
				'x_kind'     => 'transfer',
				'x_note'     => '' === $note ? null : $note,
				'created_at' => $this->now,
				'updated_at' => $this->now,
			)
		);
		$this->event( 'item', $cmd['newItemId'], 'Transferred in' );
		return self::ok();
	}

	/** The optional one-line note of a transfer or hand-off: '' for none, or null when too long. */
	private static function note_of( array $cmd ): ?string {
		$note = self::line( $cmd['note'] ?? null );
		return mb_strlen( $note ) > self::ITEM_NOTE_MAX ? null : $note;
	}

	/* ---------- wave 2: edit, hand off, undo (run through Azl_Module_Requests, so Azl_Access knows them) ---------- */

	/** A department's label from the hotel's lists (archived ones keep theirs; an unknown key shows as itself). */
	private static function dept_label( array $cat, ?string $key ): string {
		$d = null === $key ? null : Azl_Catalog::find( $cat, 'departments', $key );
		return null === $d ? (string) $key : $d['label'];
	}

	private static function person( ?string $id ): string {
		$name = null === $id ? null : Azl_Db::val( 'SELECT name FROM ' . Azl_Db::t( 'staff' ) . ' WHERE id = %s', array( $id ) );
		return $name ?? '—';
	}

	/** One history line "Field: old → new", short enough for the events table. */
	private static function change( string $field, string $old, string $new ): string {
		$cut = static function ( string $s ): string {
			$s = '' === $s ? '—' : $s;
			return mb_strlen( $s ) > 70 ? mb_substr( $s, 0, 69 ) . '…' : $s;
		};
		return "$field: " . $cut( $old ) . ' → ' . $cut( $new );
	}

	/** Writes the change lines; the first one is the op's claim. False when this op already ran. */
	private function record_changes( string $entity, string $id, array $lines ): bool {
		if ( ! $this->event( $entity, $id, $lines[0] ) ) {
			return false;
		}
		foreach ( array_slice( $lines, 1 ) as $line ) {
			$this->event( $entity, $id, $line );
		}
		return true;
	}

	/**
	 * Edit ticket (the prototype's modal): room, remarks, VIP, who asked (source and staff name) and the HDO. Only
	 * the fields sent change; every change is one history line on the request ("Room: 412 → 414"), by whom and when.
	 */
	public function edit_request( array $cmd ): array {
		$req = Azl_Db::row( 'SELECT * FROM ' . Azl_Db::t( 'requests' ) . ' WHERE id = %s' . Azl_Db::lock(), array( $cmd['requestId'] ) );
		if ( null === $req ) {
			return self::fail( 'Unknown request' );
		}
		$set   = array();
		$lines = array();
		if ( array_key_exists( 'room', $cmd ) ) {
			$room = self::line( $cmd['room'] );
			if ( '' === $room || mb_strlen( $room ) > self::ROOM_MAX ) {
				return self::fail( '' === $room ? 'Room is required' : 'Keep the room under ' . self::ROOM_MAX . ' characters' );
			}
			if ( $room !== $req['room'] ) {
				$set['room'] = $room;
				$lines[]     = self::change( 'Room', $req['room'], $room );
			}
		}
		if ( array_key_exists( 'remarks', $cmd ) ) {
			$remarks = self::para( $cmd['remarks'] );
			if ( mb_strlen( $remarks ) > self::TEXT_MAX ) {
				return self::fail( 'Keep the remarks under ' . self::TEXT_MAX . ' characters' );
			}
			if ( $remarks !== (string) $req['remarks'] ) {
				$set['remarks'] = '' === $remarks ? null : $remarks;
				$lines[]        = self::change( 'Remarks', (string) $req['remarks'], $remarks );
			}
		}
		if ( array_key_exists( 'vip', $cmd ) ) {
			if ( ! is_bool( $cmd['vip'] ) ) {
				return self::fail( 'VIP must be yes or no' );
			}
			if ( (int) $cmd['vip'] !== (int) $req['vip'] ) {
				$set['vip'] = (int) $cmd['vip'];
				$lines[]    = self::change( 'VIP', $req['vip'] ? 'yes' : 'no', $cmd['vip'] ? 'yes' : 'no' );
			}
		}
		if ( array_key_exists( 'source', $cmd ) ) {
			$source = self::source_of( $cmd );
			if ( is_string( $source ) ) {
				return self::fail( $source );
			}
			$was = self::asked_by( $req['source'], $req['staff_name'] );
			$now = self::asked_by( $source[0], $source[1] );
			if ( $was !== $now ) {
				$set['source']     = $source[0];
				$set['staff_name'] = $source[1];
				$lines[]           = self::change( 'Requested by', $was, $now );
			}
		}
		if ( array_key_exists( 'hdoId', $cmd ) ) {
			if ( ! self::valid_hdo( $cmd['hdoId'] ) ) {
				return self::fail( 'Choose a help-desk officer from the list' );
			}
			if ( $cmd['hdoId'] !== $req['hdo'] ) {
				$set['hdo'] = $cmd['hdoId'];
				$lines[]    = self::change( 'HDO', self::person( $req['hdo'] ), self::person( $cmd['hdoId'] ) );
			}
		}
		if ( array() === $lines ) {
			return self::fail( 'Nothing changed' );
		}
		if ( ! $this->record_changes( 'request', $req['id'], $lines ) ) {
			return $this->replayed( $cmd );
		}
		Azl_Db::update( 'requests', $set + array( 'updated_at' => $this->now ), array( 'id' => $req['id'] ) );
		return self::ok();
	}

	private static function asked_by( string $source, ?string $name ): string {
		return 'staff_request' === $source ? 'Staff (' . $name . ')' : 'Guest';
	}

	/**
	 * Edit item (the prototype's modal): name, quantity, department, assignee and remarks. The department changes
	 * only while the item is new (afterwards Transfer keeps the trail); the assignee only while it is open. Matching
	 * a request type of the department by name takes that type's target time. One history line per change.
	 */
	public function edit_item( array $cmd ): array {
		$it = $this->load_item( $cmd['itemId'] );
		if ( null === $it ) {
			return self::fail( self::NO_ITEM );
		}
		if ( in_array( $it['status'], array( 'transferred', 'escalated', 'cancelled' ), true ) ) {
			return self::fail( self::not_now( 'item', $it['status'] ) );
		}
		$cat   = Azl_Catalog::locked();
		$set   = array();
		$lines = array();
		$name  = $it['name'];
		$dept  = $it['dept'];
		if ( array_key_exists( 'name', $cmd ) ) {
			$name = self::line( $cmd['name'] );
			if ( '' === $name || mb_strlen( $name ) > self::NAME_MAX ) {
				return self::fail( '' === $name ? 'Describe the item' : 'Keep the item under ' . self::NAME_MAX . ' characters' );
			}
		}
		if ( array_key_exists( 'dept', $cmd ) && $cmd['dept'] !== $it['dept'] ) {
			if ( 'new' !== $it['status'] ) {
				return self::fail( 'Use Transfer to move a started item to another department' );
			}
			if ( null === Azl_Catalog::active( $cat, 'departments', $cmd['dept'] ) ) {
				return self::fail( 'Unknown department' );
			}
			$dept = $cmd['dept'];
		}
		$assignee = $it['assignee'];
		if ( array_key_exists( 'assignee', $cmd ) || $dept !== $it['dept'] ) {
			$want = array_key_exists( 'assignee', $cmd ) ? $cmd['assignee'] : null;
			if ( $want !== $it['assignee'] && ! self::is_open( $it ) && ! ( null === $want && null === $it['assignee'] ) ) {
				return self::fail( 'Only an open item can be assigned' );
			}
			$assignee = self::assignee_for( $want, $dept );
			if ( false === $assignee ) {
				return self::fail( "Assign someone from the item's department" );
			}
		}
		if ( array_key_exists( 'qty', $cmd ) && ( ! is_int( $cmd['qty'] ) || $cmd['qty'] < 1 || $cmd['qty'] > self::QTY_MAX ) ) {
			return self::fail( 'Quantity must be 1 to ' . self::QTY_MAX );
		}
		$remarks = array_key_exists( 'remarks', $cmd ) ? self::para( $cmd['remarks'] ) : (string) $it['remarks'];
		if ( mb_strlen( $remarks ) > self::REMARKS_MAX ) {
			return self::fail( 'Keep the remarks under ' . self::REMARKS_MAX . ' characters' );
		}
		if ( $name !== $it['name'] ) {
			$set['name'] = $name;
			$lines[]     = self::change( 'Item', $it['name'], $name );
		}
		if ( array_key_exists( 'qty', $cmd ) && $cmd['qty'] !== (int) $it['qty'] ) {
			$set['qty'] = $cmd['qty'];
			$lines[]    = self::change( 'Qty', (string) $it['qty'], (string) $cmd['qty'] );
		}
		if ( $dept !== $it['dept'] ) {
			$set['dept'] = $dept;
			$lines[]     = self::change( 'Department', self::dept_label( $cat, $it['dept'] ), self::dept_label( $cat, $dept ) );
		}
		if ( $assignee !== $it['assignee'] ) {
			$set['assignee'] = $assignee;
			$lines[]         = self::change( 'Assigned', self::person( $it['assignee'] ), self::person( $assignee ) );
		}
		if ( $remarks !== (string) $it['remarks'] ) {
			$set['remarks'] = '' === $remarks ? null : $remarks;
			$lines[]        = self::change( 'Remarks', (string) $it['remarks'], $remarks );
		}
		if ( array() === $lines ) {
			return self::fail( 'Nothing changed' );
		}
		if ( isset( $set['name'] ) || isset( $set['dept'] ) ) {
			foreach ( $cat['requestTypes'] as $p ) {
				if ( $p['active'] && $p['dept'] === $dept && 0 === strcasecmp( $p['label'], $name ) ) {
					$set['sla_min'] = $p['slaMin'];
				}
			}
		}
		if ( ! $this->record_changes( 'item', $it['id'], $lines ) ) {
			return $this->replayed( $cmd );
		}
		Azl_Db::update( 'items', $set + array( 'updated_at' => $this->now ), array( 'id' => $it['id'] ) );
		return self::ok();
	}

	/**
	 * Hand Off (the prototype's green form on a done item): a follow-up item for a department, with the same or
	 * another name, an optional person and note. The done item stays done; both carry the link and the history
	 * says who handed it to whom.
	 */
	public function hand_off( array $cmd ): array {
		$cat  = Azl_Catalog::locked();
		$dept = $cmd['dept'] ?? null;
		if ( null === Azl_Catalog::active( $cat, 'departments', $dept ) ) {
			return self::fail( 'Unknown department' );
		}
		$it = $this->load_item( $cmd['itemId'] );
		if ( null === $it ) {
			return self::fail( self::NO_ITEM );
		}
		if ( 'done' !== $it['status'] ) {
			return self::fail( 'Only a done item can be handed off. Use Transfer for open work.' );
		}
		$name = array_key_exists( 'name', $cmd ) ? self::line( $cmd['name'] ) : $it['name'];
		if ( '' === $name || mb_strlen( $name ) > self::NAME_MAX ) {
			return self::fail( '' === $name ? 'Describe the item' : 'Keep the item under ' . self::NAME_MAX . ' characters' );
		}
		$note = self::note_of( $cmd );
		$who  = self::assignee_for( $cmd['assignee'] ?? null, $dept );
		if ( null === $note || false === $who ) {
			return self::fail( null === $note ? 'Keep the note under ' . self::ITEM_NOTE_MAX . ' characters' : 'Assign someone from that department' );
		}
		$sla = $name === $it['name'] ? (int) $it['sla_min'] : self::OTHER_SLA_MIN;
		foreach ( $cat['requestTypes'] as $p ) {
			if ( $p['active'] && $p['dept'] === $dept && 0 === strcasecmp( $p['label'], $name ) ) {
				$sla = $p['slaMin'];
			}
		}
		$to   = self::dept_label( $cat, $dept ) . ( null === $who ? '' : ' (' . self::person( $who ) . ')' );
		$line = mb_substr( 'Handed off to ' . $to . ( '' === $note ? '' : ": $note" ), 0, 191 );
		if ( ! $this->event( 'item', $it['id'], $line ) ) {
			return $this->replayed( $cmd );
		}
		$pos = (int) Azl_Db::val( 'SELECT COUNT(*) FROM ' . Azl_Db::t( 'items' ) . ' WHERE request_id = %s', array( $it['request_id'] ) );
		Azl_Db::insert(
			'items',
			array(
				'id'         => $cmd['newItemId'],
				'request_id' => $it['request_id'],
				'pos'        => $pos,
				'name'       => $name,
				'qty'        => (int) $it['qty'],
				'dept'       => $dept,
				'assignee'   => $who,
				'status'     => 'new',
				'sla_min'    => $sla,
				'held_ms'    => 0,
				'x_from'     => $it['id'],
				'x_kind'     => 'handoff',
				'x_note'     => '' === $note ? null : $note,
				'created_at' => $this->now,
				'updated_at' => $this->now,
			)
		);
		$this->event( 'item', $cmd['newItemId'], 'Follow-up of ' . mb_substr( $it['name'], 0, 160 ) );
		return self::ok();
	}

	/*
	 * UNDO RULES (undoStep). Undo takes back the item's latest step and is written to its history as "Undone: <step>";
	 * nothing is ever deleted (an undone transfer cancels the copy it made, it does not remove it).
	 *
	 *   Step undone          From         Back to                                    Times and clocks
	 *   Relay                relayed      new                                        relay time and relayed-by cleared:
	 *                                                                                the acknowledge clock runs again from logging
	 *   On site              on_site      relayed, or new when it went on site       on-site time cleared; from new the
	 *                                     straight from new                          acknowledge time is cleared too
	 *   Hold                 on_hold      the status before the hold (relayed or     the hold is erased: hold start and reason
	 *                                     on site)                                   cleared and its minutes NOT added to the
	 *                                                                                held time (they count as working time)
	 *   Done, Can't do,      done ...     the status before (new, relayed, on site); done time cleared; from new the
	 *   Duplicate, Cancelled              an item closed while on hold comes back    acknowledge time is cleared; held time
	 *                                     on site (its hold ended when it closed)    already counted stays counted
	 *   Transfer             transferred  the status before (an on-hold item comes   done time cleared; the copy in the other
	 *                                     back on hold, its clock still stopped)     department becomes cancelled
	 *   Escalate             escalated    = undoEscalate (status before; the work order is removed, its history stays)
	 *
	 * Refused: a new item (nothing to undo); a resumed item ("put it on hold again" instead: a resume is not undone);
	 * an item closed by its work order (reopen the work order); a transfer whose copy the other department already
	 * started. "The status before" is prev_status, kept by every step; rows from before wave 2 have none, so: on site
	 * goes back to relayed (new when it was never relayed), a hold to on site, a close or transfer to on site when
	 * the item had an on-site time, else relayed. After an undo prev_status is cleared, so a second undo uses these
	 * same fallbacks (Undo can be pressed again, step by step, as in the prototype).
	 *
	 * Who: anyone who may work on the item (Azl_Access: desk roles, or department staff for their own department's
	 * items). Department staff may only undo a step they took themselves. The checkout rule is not reversed: a room
	 * readied for cleaning stays ready.
	 */

	/** Where an undo takes the item, or a refusal (string starting with '!'). Pure: also the client's rule (rules.ts). */
	public static function undo_target( array $it ): string {
		$prev = $it['prev_status'];
		switch ( $it['status'] ) {
			case 'new':
				return '!Nothing to undo';
			case 'relayed':
				return 'new';
			case 'on_site':
				if ( 'on_hold' === $prev ) {
					return '!A resume cannot be undone. Put the item on hold again.';
				}
				if ( 'new' === $prev || 'relayed' === $prev ) {
					return $prev;
				}
				$relayed = null !== $it['relayed_by'] || null === $it['on_site_at'] || ( null !== $it['ack_at'] && (int) $it['ack_at'] < (int) $it['on_site_at'] );
				return $relayed ? 'relayed' : 'new';
			case 'on_hold':
				return in_array( $prev, array( 'relayed', 'on_site' ), true ) ? $prev : 'on_site';
			case 'transferred':
				if ( in_array( $prev, Azl_Rules::OPEN_STATUSES, true ) ) {
					return $prev;
				}
				return null === $it['on_site_at'] ? 'relayed' : 'on_site';
			case 'done':
			case 'cant_do':
			case 'duplicate':
			case 'cancelled':
				if ( null !== $it['wo_id'] ) {
					return '!Closed by its work order. Reopen the work order instead.';
				}
				if ( 'on_hold' === $prev ) {
					return 'on_site';
				}
				if ( in_array( $prev, array( 'new', 'relayed', 'on_site' ), true ) ) {
					return $prev;
				}
				return null === $it['on_site_at'] ? 'relayed' : 'on_site';
		}
		return '!Nothing to undo';
	}

	/** The newest step of an item that is not undone yet: [label, by_staff], or null. Undos pair off newest first. */
	private static function last_step( string $id ): ?array {
		$rows   = Azl_Db::rows( 'SELECT what, by_staff FROM ' . Azl_Db::t( 'events' ) . " WHERE entity = 'item' AND entity_id = %s ORDER BY created_at DESC, id DESC", array( $id ) );
		$undone = 0;
		foreach ( $rows as $r ) {
			if ( 0 === strpos( $r['what'], 'Undone: ' ) ) {
				++$undone;
			} elseif ( in_array( $r['what'], self::UNDOABLE, true ) || 0 === strpos( $r['what'], 'Transferred to ' ) ) {
				if ( 0 === $undone ) {
					return array( $r['what'], $r['by_staff'] );
				}
				--$undone;
			}
		}
		return null;
	}

	public function undo_step( array $cmd ): array {
		$it = $this->load_item( $cmd['itemId'] );
		if ( null === $it ) {
			return self::fail( self::NO_ITEM );
		}
		if ( 'escalated' === $it['status'] ) {
			return $this->undo_escalate( $cmd );
		}
		$to = self::undo_target( $it );
		if ( '!' === $to[0] ) {
			return self::fail( substr( $to, 1 ) );
		}
		$step = self::last_step( $it['id'] );
		if ( null === $step && 'cancelled' === $it['status'] ) {
			return self::fail( 'Nothing to undo' ); // the copy of a transfer that was undone: its original came back instead
		}
		$what = null === $step ? str_replace( '_', ' ', $it['status'] ) : $step[0];
		if ( 'staff' === $this->who()['kind'] && ( null === $step || $step[1] !== $this->actor ) ) {
			return self::fail( 'You can only undo a step you took yourself. Ask the desk.' );
		}
		$copy = null;
		if ( 'transferred' === $it['status'] ) {
			$copy = Azl_Db::row(
				'SELECT id, status FROM ' . Azl_Db::t( 'items' ) . " WHERE x_from = %s AND status <> 'cancelled' AND (x_kind = 'transfer' OR x_kind IS NULL) ORDER BY created_at DESC, id DESC LIMIT 1" . Azl_Db::lock(),
				array( $it['id'] )
			);
			if ( null !== $copy && 'new' !== $copy['status'] ) {
				return self::fail( 'The other department already started on it. Ask them to transfer it back.' );
			}
		}
		if ( ! $this->event( 'item', $it['id'], "Undone: $what" ) ) {
			return $this->replayed( $cmd );
		}
		$set = array( 'status' => $to, 'prev_status' => null, 'updated_at' => $this->now );
		switch ( $it['status'] ) {
			case 'relayed':
				$set += array( 'ack_at' => null, 'relayed_by' => null );
				break;
			case 'on_site':
				$set += array( 'on_site_at' => null ) + ( 'new' === $to ? array( 'ack_at' => null ) : array() );
				break;
			case 'on_hold':
				$set += array( 'hold_since' => null, 'hold_reason' => null );
				break;
			default: // a close or a transfer
				$set += array( 'done_at' => null ) + ( 'new' === $to ? array( 'ack_at' => null ) : array() );
		}
		Azl_Db::update( 'items', $set, array( 'id' => $it['id'] ) );
		if ( null !== $copy ) {
			Azl_Db::update( 'items', array( 'status' => 'cancelled', 'prev_status' => 'new', 'done_at' => $this->now, 'updated_at' => $this->now ), array( 'id' => $copy['id'] ) );
			$this->event( 'item', $copy['id'], 'Cancelled: transfer undone' );
		}
		return self::ok();
	}

	/* ---------- escalation ---------- */

	/** A new work order needs an active department that handles repairs; existing ones carry on whatever happens to it. */
	private function escalate( array $cmd ): array {
		$cat = Azl_Catalog::locked();
		$it  = $this->load_item( $cmd['itemId'] );
		if ( null === $it ) {
			return self::fail( self::NO_ITEM );
		}
		$dept = Azl_Catalog::active( $cat, 'departments', $it['dept'] );
		if ( null === $dept || true !== $dept['repairs'] || ! in_array( $it['status'], array( 'on_site', 'on_hold' ), true ) ) {
			return self::fail( self::ESCALATE_ONLY );
		}
		$req = Azl_Db::row( 'SELECT room, ticket_no FROM ' . Azl_Db::t( 'requests' ) . ' WHERE id = %s', array( $it['request_id'] ) );
		if ( ! $this->event( 'work_order', $cmd['woId'], 'Escalated from request' ) ) {
			return $this->replayed( $cmd );
		}
		$n = Azl_Db::bump( 'wo' );
		Azl_Db::insert(
			'work_orders',
			array(
				'id'          => $cmd['woId'],
				'wo_no'       => $n,
				'area'        => 'Guest room',
				'loc'         => 'Room ' . $req['room'],
				'descr'       => $it['name'] . ' (from T-' . Azl_Rules::pad( (int) $req['ticket_no'] ) . ')',
				'priority'    => 'normal',
				'dept'        => $it['dept'],
				'status'      => 'reported',
				'reported_by' => $this->actor,
				'encoded_by'  => $this->actor,
				'src_item_id' => $it['id'],
				'op_id'       => $this->op,
				'created_at'  => $this->now,
				'updated_at'  => $this->now,
			)
		);
		Azl_Db::update(
			'items',
			array( 'status' => 'escalated', 'st_before_esc' => $it['status'], 'wo_id' => $cmd['woId'], 'updated_at' => $this->now ),
			array( 'id' => $it['id'] )
		);
		$this->event( 'item', $it['id'], 'Escalated to WO-' . Azl_Rules::pad( $n ) );
		return self::ok( array( 'woNo' => $n ) );
	}

	private function undo_escalate( array $cmd ): array {
		$it = $this->load_item( $cmd['itemId'] );
		if ( null === $it ) {
			return self::fail( self::NO_ITEM );
		}
		if ( 'escalated' !== $it['status'] || null === $it['wo_id'] ) {
			return self::fail( 'This item is not escalated' );
		}
		$wo = Azl_Db::val( 'SELECT status FROM ' . Azl_Db::t( 'work_orders' ) . ' WHERE id = %s' . Azl_Db::lock(), array( $it['wo_id'] ) );
		if ( 'done' === $wo ) {
			return self::fail( 'The work order is already done' );
		}
		if ( ! $this->event( 'item', $it['id'], 'Escalation undone' ) ) {
			return $this->replayed( $cmd );
		}
		Azl_Db::update(
			'items',
			array( 'status' => $it['st_before_esc'] ?? 'on_site', 'wo_id' => null, 'st_before_esc' => null, 'updated_at' => $this->now ),
			array( 'id' => $it['id'] )
		);
		Azl_Db::delete( 'work_orders', array( 'id' => $it['wo_id'] ) );
		return self::ok();
	}

	/* ---------- work orders ---------- */

	/**
	 * assessWo, startWo, holdWo, completeWo, reopenWo. From and to statuses come from the one transition table,
	 * Azl_Module_WorkOrders::TRANSITIONS; labels from WO_STEPS. Everything is checked before the claim.
	 * Optional fields (older desks send none of them): holdWo reason; completeWo notes and byId.
	 */
	private function step_wo( array $cmd, array $set ): array {
		$type    = $cmd['type'];
		$label   = self::WO_STEPS[ $type ][1];
		$to      = Azl_Module_WorkOrders::TRANSITIONS[ $type ][1];
		$note    = null;
		$note_by = $this->actor;
		if ( 'holdWo' === $type ) {
			$reason = self::line( $cmd['reason'] ?? '' );
			if ( mb_strlen( $reason ) > Azl_Module_WorkOrders::HOLD_MAX ) {
				return self::fail( 'Keep the reason under ' . Azl_Module_WorkOrders::HOLD_MAX . ' characters.' );
			}
			$set['hold_reason'] = '' === $reason ? null : $reason;
			$note               = '' === $reason ? null : "On hold: $reason";
		}
		if ( 'completeWo' === $type ) {
			$notes = self::para( $cmd['notes'] ?? '' );
			if ( mb_strlen( $notes ) > 1500 ) {
				return self::fail( 'Keep the completion notes under 1500 characters.' );
			}
			if ( isset( $cmd['byId'] ) && ! Azl_Module_WorkOrders::staff_ok( $cmd['byId'] ) ) {
				return self::fail( 'Choose who completed the work.' );
			}
			$note_by                 = isset( $cmd['byId'] ) ? strtolower( $cmd['byId'] ) : $this->actor;
			$set['completion_notes'] = '' === $notes ? null : $notes;
			$set['actual_end']       = $this->now;
			$set['hold_reason']      = null;
			$note                    = '' === $notes ? null : "Completed: $notes";
		}
		$wo = Azl_Module_WorkOrders::load( $cmd['woId'] );
		if ( null === $wo ) {
			return self::fail( 'Unknown work order' );
		}
		$no = Azl_Module_WorkOrders::refused( $type, $wo['status'] );
		if ( null !== $no ) {
			return self::fail( $no );
		}
		if ( 'startWo' === $type ) {
			$set['hold_reason']  = null; // Resume
			$set['actual_start'] = $wo['actual_start'] ?? $this->now; // the first start only
		}
		if ( 'reopenWo' === $type ) {
			$set['actual_cost']      = null;
			$set['actual_end']       = null;
			$set['completion_notes'] = null;
		}
		if ( ! $this->event( 'work_order', $wo['id'], $label ) ) {
			return $this->replayed( $cmd );
		}
		Azl_Db::update( 'work_orders', array_merge( $set, array( 'status' => $to, 'updated_at' => $this->now ) ), array( 'id' => $wo['id'] ) );
		if ( null !== $note ) {
			Azl_Updates::add( 'work_order', $wo['id'], $note, $note_by, $this->op, $this->now );
		}
		if ( 'completeWo' === $type ) {
			$this->close_source_item( $wo );
		}
		return self::ok();
	}

	/**
	 * Required: assessment, assignType. Optional: estCost (no estimate yet), contractor, assigneeId (in-house),
	 * assessedById (default: who acts), targetStart and targetEnd ('YYYY-MM-DD', end not before start).
	 */
	private function assess_wo( array $cmd ): array {
		$type = $cmd['assignType'] ?? null;
		if ( 'inhouse' !== $type && 'outsource' !== $type ) {
			return self::fail( 'Unknown assignment type' );
		}
		$est = $cmd['estCost'] ?? null;
		if ( null !== $est && ! self::valid_cost( $est ) ) {
			return self::fail( 'Enter a cost of zero or more' );
		}
		$contractor = 'outsource' === $type && is_string( $cmd['contractor'] ?? null ) ? self::line( $cmd['contractor'] ) : null;
		$assessment = self::para( $cmd['assessment'] ?? null );
		if ( '' === $assessment ) {
			return self::fail( 'Assessment required' );
		}
		if ( mb_strlen( $assessment ) > self::TEXT_MAX || ( null !== $contractor && mb_strlen( $contractor ) > self::NAME_MAX ) ) {
			return self::fail( 'Keep the text shorter' );
		}
		$assignee = 'inhouse' === $type ? ( $cmd['assigneeId'] ?? null ) : null;
		if ( null !== $assignee && ! Azl_Module_WorkOrders::staff_ok( $assignee ) ) {
			return self::fail( 'Choose who is assigned.' );
		}
		$by = $cmd['assessedById'] ?? null;
		if ( null !== $by && ! Azl_Module_WorkOrders::staff_ok( $by ) ) {
			return self::fail( 'Choose who assessed the work.' );
		}
		$dates = array();
		foreach ( array( 'targetStart' => 'target_start', 'targetEnd' => 'target_end' ) as $k => $col ) {
			$dates[ $col ] = null;
			if ( isset( $cmd[ $k ] ) && '' !== $cmd[ $k ] ) {
				$dates[ $col ] = Azl_Module_WorkOrders::date_ms( $cmd[ $k ] );
				if ( null === $dates[ $col ] ) {
					return self::fail( 'The target date is not a valid date.' );
				}
			}
		}
		if ( null !== $dates['target_start'] && null !== $dates['target_end'] && $dates['target_end'] < $dates['target_start'] ) {
			return self::fail( 'The end date is before the start date.' );
		}
		return $this->step_wo(
			$cmd,
			array(
				'assessment'  => $assessment,
				'assign_type' => $type,
				'contractor'  => $contractor,
				'est_cost'    => null === $est ? null : sprintf( '%.2f', $est ),
				'assignee'    => null === $assignee ? null : strtolower( $assignee ),
				'assessed_by' => null === $by ? $this->actor : strtolower( $by ),
				'assessed_at' => $this->now,
			) + $dates
		);
	}

	private function close_source_item( array $wo ): void {
		if ( null === $wo['src_item_id'] ) {
			return;
		}
		$it = $this->load_item( $wo['src_item_id'] );
		if ( null === $it || 'escalated' !== $it['status'] ) {
			return;
		}
		$this->close_item( $it, 'done' );
		$this->event( 'item', $it['id'], 'Closed by WO-' . Azl_Rules::pad( (int) $wo['wo_no'] ) );
	}

	/* ---------- cleaning ---------- */

	private function clean_set( array $cmd ): array {
		$status = $cmd['status'] ?? null;
		if ( ! in_array( $status, self::CLEAN_STATUSES, true ) ) {
			return self::fail( 'Unknown cleaning status' );
		}
		$task = Azl_Db::row( 'SELECT id, clock_in, clock_out FROM ' . Azl_Db::t( 'clean_tasks' ) . ' WHERE id = %s' . Azl_Db::lock(), array( $cmd['taskId'] ) );
		if ( null === $task ) {
			return self::fail( 'Unknown cleaning task' );
		}
		if ( ! $this->event( 'clean_task', $cmd['taskId'], 'Cleaning update' ) ) {
			return $this->replayed( $cmd );
		}
		// Keep the clock times the Cleaning table shows: starting stamps clock-in, finishing stamps clock-out.
		$set = array( 'status' => $status, 'updated_at' => $this->now );
		if ( 'in_progress' === $status && null === $task['clock_in'] ) {
			$set['clock_in'] = $this->now;
		}
		if ( 'done' === $status && null === $task['clock_out'] ) {
			$set['clock_out'] = $this->now;
		}
		Azl_Db::update( 'clean_tasks', $set, array( 'id' => $cmd['taskId'] ) );
		return self::ok();
	}

	/* ---------- safety ---------- */

	private function raise_safety( array $cmd ): array {
		$hazard = $cmd['hazard'] ?? null;
		if ( ! is_string( $hazard ) || ! isset( Azl_Rules::HAZARDS[ $hazard ] ) ) {
			return self::fail( 'Unknown hazard' );
		}
		$room = self::line( $cmd['room'] ?? null );
		$text = self::para( $cmd['text'] ?? null );
		if ( '' === $room || '' === $text ) {
			return self::fail( 'Room and what was said are required' );
		}
		if ( mb_strlen( $room ) > self::ROOM_MAX || mb_strlen( $text ) > self::TEXT_MAX ) {
			return self::fail( 'Keep the text shorter' );
		}
		// Newest active incident of this hazard in the last 15 minutes that this room has not reported yet.
		$recent = Azl_Db::rows(
			'SELECT id, inc_no, rooms FROM ' . Azl_Db::t( 'incidents' )
				. " WHERE hazard = %s AND status = 'active' AND created_at > %d ORDER BY created_at DESC, id DESC" . Azl_Db::lock(),
			array( $hazard, $this->now - self::CLUSTER_MINUTES * 60000 )
		);
		foreach ( $recent as $near ) {
			$rooms = self::rooms( $near['rooms'] );
			if ( in_array( $room, $rooms, true ) ) {
				continue;
			}
			if ( ! $this->event( 'incident', $near['id'], "Second report from room $room: treated as one incident" ) ) {
				return $this->replayed( $cmd );
			}
			$rooms[] = $room;
			Azl_Db::update( 'incidents', array( 'rooms' => wp_json_encode( $rooms ), 'updated_at' => $this->now ), array( 'id' => $near['id'] ) );
			return self::ok( array( 'clusteredInto' => $near['id'], 'incidentNo' => (int) $near['inc_no'] ) );
		}
		if ( ! $this->event( 'incident', $cmd['incidentId'], self::ALERT ) ) {
			return $this->replayed( $cmd );
		}
		$n = Azl_Db::bump( 'inc' );
		Azl_Db::insert(
			'incidents',
			array(
				'id'         => $cmd['incidentId'],
				'inc_no'     => $n,
				'hazard'     => $hazard,
				'rooms'      => wp_json_encode( array( $room ) ),
				'report'     => $text,
				'status'     => 'active',
				'op_id'      => $this->op,
				'created_at' => $this->now,
				'updated_at' => $this->now,
			)
		);
		return self::ok( array( 'incidentNo' => $n ) );
	}

	/** @return string[] */
	public static function rooms( ?string $json ): array {
		$r = null === $json ? null : json_decode( $json, true );
		return is_array( $r ) ? array_values( array_map( 'strval', $r ) ) : array();
	}

	private function load_incident( string $id ): ?array {
		return Azl_Db::row( 'SELECT id, status, called911_at FROM ' . Azl_Db::t( 'incidents' ) . ' WHERE id = %s' . Azl_Db::lock(), array( $id ) );
	}

	private function set_incident_status( array $cmd ): array {
		$down             = 'downgradeIncident' === $cmd['type'];
		list( $status, $label ) = $down
			? array( 'downgraded', 'Downgraded by staff (logged)' )
			: array( 'resolved', 'Resolved with engineer and manager sign-off' );
		$inc = $this->load_incident( $cmd['incidentId'] );
		if ( null === $inc ) {
			return self::fail( 'Unknown incident' );
		}
		if ( 'active' !== $inc['status'] ) {
			return self::fail( 'This incident is no longer active' );
		}
		if ( ! $this->event( 'incident', $inc['id'], $label ) ) {
			return $this->replayed( $cmd );
		}
		Azl_Db::update( 'incidents', array( 'status' => $status, 'updated_at' => $this->now ), array( 'id' => $inc['id'] ) );
		return self::ok();
	}

	/** An ISO 8601 date-time from the device, as epoch ms, or null. */
	public static function iso_ms( $at ): ?int {
		if ( ! is_string( $at ) || strlen( $at ) > 40
			|| ! preg_match( '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?\z/', $at ) ) {
			return null;
		}
		try {
			$d = new DateTimeImmutable( $at, new DateTimeZone( 'UTC' ) );
		} catch ( Exception $e ) {
			return null;
		}
		return (int) $d->format( 'U' ) * 1000 + (int) $d->format( 'v' );
	}

	private function record_911( array $cmd ): array {
		$at = self::iso_ms( $cmd['at'] ?? null );
		if ( null === $at ) {
			return self::fail( 'The call time is not a valid date' );
		}
		$inc = $this->load_incident( $cmd['incidentId'] );
		if ( null === $inc ) {
			return self::fail( 'Unknown incident' );
		}
		if ( null !== $inc['called911_at'] ) {
			return self::fail( self::LOCKED_911 );
		}
		if ( ! $this->event( 'incident', $inc['id'], 'BFP/911 called at ' . $cmd['at'] ) ) {
			return $this->replayed( $cmd );
		}
		// Set once: the row lock above serialises callers, and the IS NULL guard refuses a second write
		// even without it. A refusal rolls the claim back with everything else.
		$n = Azl_Db::exec(
			'UPDATE ' . Azl_Db::t( 'incidents' ) . ' SET called911_by = ' . Azl_Db::literal( $this->actor )
				. ', called911_at = %d, updated_at = %d WHERE id = %s AND called911_at IS NULL',
			array( $at, $this->now, $inc['id'] )
		);
		return 1 === $n ? self::ok() : self::fail( self::LOCKED_911 );
	}

	/* ---------- handover ---------- */

	private function ack_handover( array $cmd ): array {
		$note = $cmd['note'] ?? null;
		if ( null !== $note && ! is_string( $note ) ) {
			return self::fail( 'The note must be text' );
		}
		$note = self::para( $note );
		if ( mb_strlen( $note ) > self::NOTE_MAX ) {
			return self::fail( 'Keep the note under ' . self::NOTE_MAX . ' characters' );
		}
		$h = Azl_Db::t( 'handovers' );
		if ( null !== Azl_Db::val( "SELECT 1 FROM $h WHERE id = %s", array( $cmd['handoverId'] ) ) ) {
			return self::fail( 'This handover is already signed off' );
		}
		if ( ! $this->event( 'handover', $cmd['handoverId'], 'Handover acknowledged' ) ) {
			return $this->replayed( $cmd );
		}
		Azl_Db::insert(
			'handovers',
			array(
				'id'         => $cmd['handoverId'],
				'signed_by'  => $this->actor,
				'note'       => '' === $note ? null : $note,
				'op_id'      => $this->op,
				'created_at' => $this->now,
			)
		);
		return self::ok();
	}

	/** The client's returnOrphans(): open items whose assignee is off shift (or removed) go back to the department queue. */
	private function return_orphans( array $cmd ): array {
		$ids = $cmd['itemIds'];
		if ( 0 === count( $ids ) || count( $ids ) > self::MAX_RETURN || count( array_unique( $ids ) ) !== count( $ids ) ) {
			return self::fail( 'Choose the items to return' );
		}
		$rows = Azl_Db::rows(
			'SELECT i.id, i.status, i.assignee, s.on_shift, s.active FROM ' . Azl_Db::t( 'items' ) . ' i LEFT JOIN '
				. Azl_Db::t( 'staff' ) . ' s ON s.id = i.assignee WHERE i.id IN (' . Azl_Db::in( $ids ) . ') ORDER BY i.created_at, i.pos, i.id'
				. Azl_Db::lock(),
			$ids
		);
		if ( count( $rows ) !== count( $ids ) ) {
			return self::fail( self::NO_ITEM );
		}
		$orphans = array();
		foreach ( $rows as $x ) {
			$covered = '1' === (string) $x['on_shift'] && '1' === (string) $x['active'];
			if ( in_array( $x['status'], Azl_Rules::OPEN_STATUSES, true ) && null !== $x['assignee'] && ! $covered ) {
				$orphans[] = $x['id'];
			}
		}
		if ( array() === $orphans ) {
			return self::fail( 'Nothing to return. These items already have someone on shift.' );
		}
		if ( ! $this->event( 'item', $orphans[0], self::RETURNED ) ) {
			return $this->replayed( $cmd );
		}
		foreach ( array_slice( $orphans, 1 ) as $id ) {
			$this->event( 'item', $id, self::RETURNED );
		}
		Azl_Db::exec(
			'UPDATE ' . Azl_Db::t( 'items' ) . ' SET assignee = NULL, updated_at = %d WHERE id IN (' . Azl_Db::in( $orphans ) . ')',
			array_merge( array( $this->now ), $orphans )
		);
		return self::ok();
	}
}
