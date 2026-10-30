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

	private function insert_items( string $request_id, array $specs, array $ids, string $label, int $first_pos ): void {
		foreach ( $specs as $i => $s ) {
			Azl_Db::insert(
				'items',
				array(
					'id'         => $ids[ $i ],
					'request_id' => $request_id,
					'pos'        => $first_pos + $i,
					'name'       => $s[0],
					'qty'        => 1,
					'dept'       => $s[1],
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

	private function log_request( array $cmd ): array {
		$room = self::line( $cmd['room'] ?? null );
		if ( '' === $room ) {
			return self::fail( 'Room is required' );
		}
		if ( mb_strlen( $room ) > self::ROOM_MAX ) {
			return self::fail( 'Keep the room under ' . self::ROOM_MAX . ' characters' );
		}
		$cat     = Azl_Catalog::locked();
		$presets = self::preset_specs( $cat, $cmd['presets'] ?? array() );
		$parts   = self::bundle_specs( $cat, $cmd['bundle'] ?? null, null === $presets ? 0 : count( $presets ) );
		if ( null === $presets || null === $parts ) {
			return self::fail( 'Unknown request type' );
		}
		$specs = array_merge( $presets, $parts );
		if ( ! self::ids_match( $cmd['itemIds'], count( $specs ) ) ) {
			return self::fail( 'Item ids do not match the items' );
		}
		$remarks = is_string( $cmd['remarks'] ?? null ) ? self::para( $cmd['remarks'] ) : null;
		if ( null !== $remarks && mb_strlen( $remarks ) > self::TEXT_MAX ) {
			return self::fail( 'Keep the remarks under ' . self::TEXT_MAX . ' characters' );
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
				'source'     => 'staff',
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
		$specs = self::preset_specs( $cat, $cmd['presets'] ?? null );
		if ( null === $specs ) {
			return self::fail( 'Unknown request type' );
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
				$data = array( 'status' => 'relayed', 'ack_at' => $this->now, 'assignee' => $it['assignee'] ?? $this->first_on_shift( $it['dept'] ) );
				break;
			case 'onSite':
				$data = array( 'status' => 'on_site', 'ack_at' => $ack, 'assignee' => $it['assignee'] ?? $this->first_on_shift( $it['dept'] ) );
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
		$data['updated_at'] = $this->now;
		Azl_Db::update( 'items', $data, array( 'id' => $it['id'] ) );
		return self::ok();
	}

	/** The client's closeItem(): close, stop any hold clock, and ready the room after a checkout or inspection. */
	private function close_item( array $it, string $status ): void {
		Azl_Db::update(
			'items',
			array(
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
		if ( ! $this->event( 'item', $it['id'], "Transferred to $dept" ) ) {
			return $this->replayed( $cmd );
		}
		Azl_Db::update( 'items', array( 'status' => 'transferred', 'done_at' => $this->now, 'updated_at' => $this->now ), array( 'id' => $it['id'] ) );
		Azl_Db::insert(
			'items',
			array(
				'id'         => $cmd['newItemId'],
				'request_id' => $it['request_id'],
				'pos'        => (int) $it['pos'],
				'name'       => $it['name'],
				'qty'        => (int) $it['qty'],
				'dept'       => $dept,
				'status'     => 'new',
				'sla_min'    => (int) $it['sla_min'],
				'held_ms'    => 0,
				'depends_on' => $it['depends_on'],
				'x_from'     => $it['id'],
				'created_at' => $this->now,
				'updated_at' => $this->now,
			)
		);
		$this->event( 'item', $cmd['newItemId'], 'Transferred in' );
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

	private function step_wo( array $cmd, array $set ): array {
		list( $from, $label ) = self::WO_STEPS[ $cmd['type'] ];
		$wo                   = Azl_Db::row(
			'SELECT id, wo_no, status, src_item_id FROM ' . Azl_Db::t( 'work_orders' ) . ' WHERE id = %s' . Azl_Db::lock(),
			array( $cmd['woId'] )
		);
		if ( null === $wo ) {
			return self::fail( 'Unknown work order' );
		}
		if ( ! in_array( $wo['status'], $from, true ) ) {
			return self::fail( self::not_now( 'work order', $wo['status'] ) );
		}
		if ( ! $this->event( 'work_order', $wo['id'], $label ) ) {
			return $this->replayed( $cmd );
		}
		$status = array(
			'assessWo'   => 'assessed',
			'startWo'    => 'in_progress',
			'holdWo'     => 'on_hold',
			'completeWo' => 'done',
			'reopenWo'   => 'in_progress',
		)[ $cmd['type'] ];
		if ( 'reopenWo' === $cmd['type'] ) {
			$set['actual_cost'] = null;
		}
		Azl_Db::update( 'work_orders', array_merge( $set, array( 'status' => $status, 'updated_at' => $this->now ) ), array( 'id' => $wo['id'] ) );
		if ( 'completeWo' === $cmd['type'] ) {
			$this->close_source_item( $wo );
		}
		return self::ok();
	}

	private function assess_wo( array $cmd ): array {
		$type = $cmd['assignType'] ?? null;
		if ( 'inhouse' !== $type && 'outsource' !== $type ) {
			return self::fail( 'Unknown assignment type' );
		}
		if ( ! self::valid_cost( $cmd['estCost'] ?? null ) ) {
			return self::fail( 'Enter a cost of zero or more' );
		}
		$contractor = is_string( $cmd['contractor'] ?? null ) ? self::line( $cmd['contractor'] ) : null;
		$assessment = self::para( $cmd['assessment'] ?? null );
		if ( mb_strlen( $assessment ) > self::TEXT_MAX || ( null !== $contractor && mb_strlen( $contractor ) > self::NAME_MAX ) ) {
			return self::fail( 'Keep the text shorter' );
		}
		return $this->step_wo(
			$cmd,
			array(
				'assessment'  => $assessment,
				'assign_type' => $type,
				'contractor'  => $contractor,
				'est_cost'    => sprintf( '%.2f', $cmd['estCost'] ),
			)
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
		$task = Azl_Db::val( 'SELECT id FROM ' . Azl_Db::t( 'clean_tasks' ) . ' WHERE id = %s' . Azl_Db::lock(), array( $cmd['taskId'] ) );
		if ( null === $task ) {
			return self::fail( 'Unknown cleaning task' );
		}
		if ( ! $this->event( 'clean_task', $cmd['taskId'], 'Cleaning update' ) ) {
			return $this->replayed( $cmd );
		}
		Azl_Db::update( 'clean_tasks', array( 'status' => $status, 'updated_at' => $this->now ), array( 'id' => $cmd['taskId'] ) );
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
