<?php
/**
 * Crisis Mgmt: the client prototype's crisis CASE LOG (radio codes 10-x, complaint category, who, where, what,
 * updates, Monitor, Close with a resolution, Reopen, Edit), joined to the safety lane.
 *
 * The case log sits BEHIND the safety lane and never replaces it (docs/azalea-ehelpdesk-build-brief.md sections 3.5
 * and 6): the hazard takeover, the 911 recording, "Staff notified (not BFP/911)" and the resolve-with-sign-off rule of
 * azl_incidents are untouched here. A case may link one safety alert (incident_id); it never changes the alert.
 *
 * Rules that differ from the prototype on purpose:
 * - A case is saved with only a radio code, or only a complaint category, or only a linked alert. "What happened"
 *   may be filled in later (help is summoned before anything is typed).
 * - The 911 call of a linked case is the alert's own record (azl_incidents.called911_*), shown on the case, never
 *   copied: one call, one record. A case WITHOUT an alert (a medical case logged by hand) records its own call once
 *   (recordCrisis911), so every crisis has the brief's "BFP/911 called by __ at __" field.
 * - Closing needs a resolution and full access (owner, manager, supervisor; on a shared phone a supervisor or
 *   manager PIN), like resolving a safety alert. Help-desk officers and department staff log, update, monitor,
 *   edit and reopen.
 * - The log is evidence: every change, an edit included, adds a line to the case's updates (azl_updates) naming
 *   what changed; nothing is deleted.
 *
 * case_status (pending/closed) of the prototype is not stored: it is status = resolved or not.
 *
 * @package azl-ehd
 */

defined( 'ABSPATH' ) || exit;

final class Azl_Module_Crisis extends Azl_Module {

	const ENTITY       = 'crisis';
	const STATUSES     = array( 'active', 'monitoring', 'resolved' );
	const CLOSED_DAYS  = 30;
	const NAME_MAX     = 120;
	const PLACE_MAX    = 80;
	const TEXT_MAX     = 2000;
	const FUTURE_MS    = 300000;           // a clock a few minutes fast is fine
	const PAST_MS      = 366 * 86400000;   // back-filling up to a year
	const NEED_ONE     = 'Choose a radio code or a complaint category';
	const NO_CASE      = 'Unknown case';
	const NO_ALERT     = 'Unknown safety alert';
	const LOCKED_911   = 'The 911 call is already recorded for this case';
	const CLOSED       = 'This case is closed. Reopen it first.';
	const CAT_ONLY     = 'A complaint category goes with a guest complaint code';

	/** Hazard of a safety alert => the seeded radio code a case opened from it starts with. */
	const HAZARD_CODE = array(
		'smoke'   => 'fire',
		'medical' => 'medical_emergency',
		'threat'  => 'security_threat',
		'gas'     => 'other',
		'flood'   => 'other',
		'lift'    => 'other',
	);

	/** Command field => [column, list key or null, label for the edit line, max length or 0 for a key]. */
	const FIELDS = array(
		'code'       => array( 'code', 'crisisCodes', 'Code', 0 ),
		'category'   => array( 'comp_cat', 'complaintCategories', 'Category', 0 ),
		'reportedBy' => array( 'reported_by', null, 'Reported by', self::NAME_MAX ),
		'whoType'    => array( 'who_type', 'involvedTypes', 'Involved', 0 ),
		'who'        => array( 'who', null, 'Involved name', self::NAME_MAX ),
		'location'   => array( 'location', 'crisisLocations', 'Where', 0 ),
		'place'      => array( 'place', null, 'Room or place', self::PLACE_MAX ),
		'what'       => array( 'what', null, 'What happened', self::TEXT_MAX ),
	);

	public function id(): string {
		return 'crisis';
	}

	public function schema() {
		return 'CREATE TABLE ' . Azl_Db::t( 'crisis_cases' ) . " (
  id char(36) NOT NULL,
  cr_no int(11) unsigned NOT NULL,
  code varchar(20) DEFAULT NULL,
  comp_cat varchar(20) DEFAULT NULL,
  reported_by varchar(120) DEFAULT NULL,
  who_type varchar(20) DEFAULT NULL,
  who varchar(120) DEFAULT NULL,
  what text DEFAULT NULL,
  occurred_at bigint(20) NOT NULL,
  location varchar(20) DEFAULT NULL,
  place varchar(80) DEFAULT NULL,
  status varchar(20) NOT NULL DEFAULT 'active',
  resolution text DEFAULT NULL,
  resolved_at bigint(20) DEFAULT NULL,
  incident_id char(36) DEFAULT NULL,
  called911_by char(36) DEFAULT NULL,
  called911_at bigint(20) DEFAULT NULL,
  logged_by char(36) DEFAULT NULL,
  op_id char(36) NOT NULL,
  created_at bigint(20) NOT NULL,
  updated_at bigint(20) NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY cr_no (cr_no),
  UNIQUE KEY op_id (op_id),
  KEY status_resolved (status,resolved_at),
  KEY incident_id (incident_id),
  KEY created_at (created_at)
) " . Azl_Schema::table_options() . ';';
	}

	public function sequences(): array {
		return array( 'cr' );
	}

	/** The prototype's lists (A.13). Keys come from the labels and never change; labels and fields are editable. */
	public function catalogLists(): array {
		$plain = static function ( array $labels ): array {
			return array_map(
				static function ( $l ) {
					return array( 'label' => $l );
				},
				$labels
			);
		};
		$codes = array(
			array( '10-9', 'Medical Emergency' ),
			array( '10-28', 'Guest Complaint', true ),
			array( '10-1', 'Fire' ),
			array( '10-2', 'Earthquake' ),
			array( '10-3', 'Typhoon' ),
			array( '10-4', 'Bomb Threat' ),
			array( '10-5', 'Power Outage' ),
			array( '10-6', 'Water Interruption' ),
			array( '10-7', 'Security Threat' ),
			array( '10-8', 'Civil Disturbance' ),
			array( '10-0', 'Other' ),
		);
		$places = array( 'Room', 'Lobby', 'Restaurant', 'Pool Area', 'Gym / Fitness Center', 'Parking Area', 'Elevator', 'Hallway / Corridor', 'Reception / Front Desk', 'Back Office', 'Kitchen', 'Laundry', 'Staff Area', 'Function Room', 'Garden / Outdoor', 'Other' );
		return array(
			'crisisCodes'         => array(
				'label'    => array( 'radio code', 'radio codes' ),
				'maxItems' => 30,
				'fields'   => array(
					array( 'name' => 'code', 'label' => 'radio code', 'type' => 'text', 'max' => 8, 'required' => true ),
					array( 'name' => 'complaint', 'label' => 'guest complaint', 'type' => 'bool', 'default' => false ),
				),
				'seed'     => array_map(
					static function ( $c ) {
						return array( 'label' => $c[1], 'code' => $c[0], 'complaint' => $c[2] ?? false );
					},
					$codes
				),
			),
			'complaintCategories' => array(
				'label'    => array( 'complaint category', 'complaint categories' ),
				'maxItems' => 30,
				'fields'   => array(),
				'seed'     => $plain( array( 'Room Condition', 'Noise', 'Cleanliness', 'Food Quality', 'Service Attitude', 'Billing', 'Amenities', 'AC / Temperature', 'WiFi / Internet', 'Wait Time', 'Other' ) ),
			),
			'crisisLocations'     => array(
				'label'    => array( 'crisis location', 'crisis locations' ),
				'maxItems' => 40,
				// detail: the question asked next to this place ("Room No." for Room, "Specify" for Other), or none.
				'fields'   => array( array( 'name' => 'detail', 'label' => 'follow-up question', 'type' => 'text', 'max' => 20, 'required' => false ) ),
				'seed'     => array_map(
					static function ( $p ) {
						return array( 'label' => $p, 'detail' => 'Room' === $p ? 'Room No.' : ( 'Other' === $p ? 'Specify' : '' ) );
					},
					$places
				),
			),
			'involvedTypes'       => array(
				'label'    => array( 'involved type', 'involved types' ),
				'maxItems' => 20,
				'fields'   => array(),
				'seed'     => $plain( array( 'In-house Guest', 'Non-guest', 'Restaurant Guest', 'Supplier', 'Staff' ) ),
			),
		);
	}

	public function commands(): array {
		$number = static function ( string $id ): array {
			$n = Azl_Db::val( 'SELECT cr_no FROM ' . Azl_Db::t( 'crisis_cases' ) . ' WHERE id = %s', array( $id ) );
			return null === $n ? array() : array( 'caseNo' => (int) $n );
		};
		$text   = static function ( string $what ): callable {
			return static function ( array $cmd ) use ( $what ): ?string {
				$t = Azl_Commands::para( $cmd[ 'resolution' === $what ? 'resolution' : 'text' ] ?? null );
				if ( '' === $t ) {
					return 'resolution' === $what ? 'Write the resolution' : "Write the $what";
				}
				return mb_strlen( $t ) > self::TEXT_MAX ? 'Keep the text shorter' : null;
			};
		};
		return array(
			'logCrisis'          => array(
				'ids'   => array( 'caseId' ),
				'run'   => array( $this, 'log' ),
				'prior' => $number,
			),
			'updateCrisis'       => array(
				'ids'      => array( 'caseId' ),
				'validate' => $text( 'update' ),
				'run'      => array( $this, 'update' ),
			),
			'monitorCrisis'      => array(
				'ids'      => array( 'caseId' ),
				'validate' => $text( 'monitoring note' ),
				'run'      => array( $this, 'monitor' ),
			),
			'closeCrisis'        => array(
				'ids'      => array( 'caseId' ),
				'need'     => 'full',
				'validate' => $text( 'resolution' ),
				'run'      => array( $this, 'close' ),
			),
			'reopenCrisis'       => array(
				'ids' => array( 'caseId' ),
				'run' => array( $this, 'reopen' ),
			),
			'editCrisis'         => array(
				'ids' => array( 'caseId' ),
				'run' => array( $this, 'edit' ),
			),
			'linkCrisisIncident' => array(
				'ids' => array( 'caseId', 'incidentId' ),
				'run' => array( $this, 'link' ),
			),
			'recordCrisis911'    => array(
				'ids' => array( 'caseId' ),
				'run' => array( $this, 'record_911' ),
			),
		);
	}

	/* ---------- reading ---------- */

	private static function load( string $id ): ?array {
		return Azl_Db::row( 'SELECT * FROM ' . Azl_Db::t( 'crisis_cases' ) . ' WHERE id = %s' . Azl_Db::lock(), array( $id ) );
	}

	private static function incident( string $id ): ?array {
		return Azl_Db::row( 'SELECT id, inc_no, hazard, rooms, created_at, report FROM ' . Azl_Db::t( 'incidents' ) . ' WHERE id = %s', array( $id ) );
	}

	private static function inc_no( array $inc ): string {
		return 'INC-' . Azl_Rules::pad( (int) $inc['inc_no'], 3 );
	}

	/** The label shown for a list key ("10-9 Medical Emergency" for a radio code); an unknown key shows as itself. */
	private static function shown( array $cat, string $list, ?string $key ): string {
		if ( null === $key || '' === $key ) {
			return 'none';
		}
		$x = Azl_Catalog::find( $cat, $list, $key );
		if ( null === $x ) {
			return $key;
		}
		return 'crisisCodes' === $list && '' !== (string) ( $x['code'] ?? '' ) ? $x['code'] . ' ' . $x['label'] : $x['label'];
	}

	/**
	 * The case fields of a log or edit command, checked: list keys must be active (an archived key may stay on a case
	 * that already has it), texts within their lengths, the time a valid date that is not in the future.
	 *
	 * @return array|string the columns, or the problem in plain language
	 */
	private static function fields( array $cmd, array $cat, int $now, ?array $cur ): array|string {
		$out = array();
		foreach ( self::FIELDS as $field => list( $col, $list, , $max ) ) {
			$v = $cmd[ $field ] ?? null;
			if ( null !== $v && ! is_string( $v ) ) {
				return 'Not a valid ' . strtolower( self::FIELDS[ $field ][2] );
			}
			$v = 'what' === $field ? Azl_Commands::para( $v ) : Azl_Commands::line( $v );
			if ( null !== $list ) {
				$keep = null !== $cur && $cur[ $col ] === $v;
				if ( '' !== $v && ! $keep && null === Azl_Catalog::active( $cat, $list, $v ) ) {
					return 'Unknown ' . strtolower( self::FIELDS[ $field ][2] ) . '. Pick one from the list.';
				}
			} elseif ( mb_strlen( $v ) > $max ) {
				return 'Keep the ' . strtolower( self::FIELDS[ $field ][2] ) . " under $max characters";
			}
			$out[ $col ] = '' === $v ? null : $v;
		}
		if ( null !== $out['comp_cat'] && null !== $out['code'] && true !== ( Azl_Catalog::find( $cat, 'crisisCodes', $out['code'] )['complaint'] ?? false ) ) {
			return self::CAT_ONLY;
		}
		if ( array_key_exists( 'occurredAt', $cmd ) ) {
			$at = Azl_Commands::iso_ms( $cmd['occurredAt'] );
			if ( null === $at || $at > $now + self::FUTURE_MS || $at < $now - self::PAST_MS ) {
				return 'The time is not a valid date (not in the future, at most a year ago)';
			}
			$out['occurred_at'] = $at;
		}
		return $out;
	}

	/* ---------- commands ---------- */

	public function log( array $cmd, Azl_Commands $ctx ): array {
		$cat = Azl_Catalog::get();
		$set = self::fields( $cmd, $cat, $ctx->now(), null );
		if ( is_string( $set ) ) {
			return Azl_Commands::fail( $set );
		}
		$inc = null;
		if ( isset( $cmd['incidentId'] ) ) {
			$inc = self::incident( $cmd['incidentId'] );
			if ( null === $inc ) {
				return Azl_Commands::fail( self::NO_ALERT );
			}
			// Opened from an alert with no code chosen: the code that matches the hazard, while it is offered.
			if ( null === $set['code'] && null === $set['comp_cat'] ) {
				$key         = self::HAZARD_CODE[ $inc['hazard'] ] ?? null;
				$set['code'] = null !== Azl_Catalog::active( $cat, 'crisisCodes', $key ) ? $key : null;
			}
		}
		// CALL 911 / RADIO FIRST, THEN LOG: a code alone is enough (or a category, or the alert it came from).
		if ( null === $set['code'] && null === $set['comp_cat'] && null === $inc ) {
			return Azl_Commands::fail( self::NEED_ONE );
		}
		$id = $cmd['caseId'];
		if ( null !== Azl_Db::val( 'SELECT id FROM ' . Azl_Db::t( 'crisis_cases' ) . ' WHERE id = %s', array( $id ) ) ) {
			return Azl_Commands::fail( 'This case already exists' );
		}
		if ( ! $ctx->claim( self::ENTITY, $id, 'Case logged' ) ) {
			return $ctx->replay( $cmd );
		}
		$n = Azl_Db::bump( 'cr' );
		Azl_Db::insert(
			'crisis_cases',
			$set + array(
				'id'          => $id,
				'cr_no'       => $n,
				'occurred_at' => $ctx->now(),
				'status'      => 'active',
				'incident_id' => null === $inc ? null : $inc['id'],
				'logged_by'   => $ctx->actor(),
				'op_id'       => $ctx->op(),
				'created_at'  => $ctx->now(),
				'updated_at'  => $ctx->now(),
			)
		);
		if ( null !== $inc ) {
			Azl_Updates::add( self::ENTITY, $id, 'Opened from safety alert ' . self::inc_no( $inc ), $ctx->actor(), $ctx->op(), $ctx->now() );
		}
		return Azl_Commands::ok( array( 'caseNo' => $n ) );
	}

	/** Loads the case for a change; null with the refusal when it is unknown or (for $open) closed. */
	private static function target( array $cmd, bool $open, ?array &$row ): ?array {
		$row = self::load( $cmd['caseId'] );
		if ( null === $row ) {
			return Azl_Commands::fail( self::NO_CASE );
		}
		return $open && 'resolved' === $row['status'] ? Azl_Commands::fail( self::CLOSED ) : null;
	}

	/** Claims the op, writes the columns and adds one line to the case's updates. */
	private static function write( Azl_Commands $ctx, array $cmd, string $what, array $set, string $line ): array {
		if ( ! $ctx->claim( self::ENTITY, $cmd['caseId'], $what ) ) {
			return $ctx->replay( $cmd );
		}
		if ( array() !== $set ) {
			Azl_Db::update( 'crisis_cases', $set + array( 'updated_at' => $ctx->now() ), array( 'id' => $cmd['caseId'] ) );
		}
		Azl_Updates::add( self::ENTITY, $cmd['caseId'], $line, $ctx->actor(), $ctx->op(), $ctx->now() );
		return Azl_Commands::ok();
	}

	public function update( array $cmd, Azl_Commands $ctx ): array {
		$refused = self::target( $cmd, true, $row );
		return $refused ?? self::write( $ctx, $cmd, 'Update added', array(), Azl_Commands::para( $cmd['text'] ) );
	}

	public function monitor( array $cmd, Azl_Commands $ctx ): array {
		$refused = self::target( $cmd, true, $row );
		if ( null !== $refused ) {
			return $refused;
		}
		if ( 'active' !== $row['status'] ) {
			return Azl_Commands::fail( 'This case is already being monitored' );
		}
		return self::write( $ctx, $cmd, 'Monitoring', array( 'status' => 'monitoring' ), 'Monitoring: ' . Azl_Commands::para( $cmd['text'] ) );
	}

	public function close( array $cmd, Azl_Commands $ctx ): array {
		$refused = self::target( $cmd, true, $row );
		if ( null !== $refused ) {
			return $refused;
		}
		$res = Azl_Commands::para( $cmd['resolution'] );
		return self::write( $ctx, $cmd, 'Closed', array( 'status' => 'resolved', 'resolution' => $res, 'resolved_at' => $ctx->now() ), 'Closed: ' . $res );
	}

	public function reopen( array $cmd, Azl_Commands $ctx ): array {
		$refused = self::target( $cmd, false, $row );
		if ( null !== $refused ) {
			return $refused;
		}
		if ( 'resolved' !== $row['status'] ) {
			return Azl_Commands::fail( 'This case is still open' );
		}
		// The old resolution stays in the updates ("Closed: ..."); the case is open again, under monitoring.
		return self::write( $ctx, $cmd, 'Reopened', array( 'status' => 'monitoring', 'resolution' => null, 'resolved_at' => null ), 'Reopened' );
	}

	public function edit( array $cmd, Azl_Commands $ctx ): array {
		$refused = self::target( $cmd, false, $row );
		if ( null !== $refused ) {
			return $refused;
		}
		$cat = Azl_Catalog::get();
		$set = self::fields( $cmd, $cat, $ctx->now(), $row );
		if ( is_string( $set ) ) {
			return Azl_Commands::fail( $set );
		}
		if ( null === $set['code'] && null === $set['comp_cat'] && null === $row['incident_id'] ) {
			return Azl_Commands::fail( self::NEED_ONE );
		}
		$changes = array();
		foreach ( self::FIELDS as list( $col, $list, $label ) ) {
			if ( $set[ $col ] === $row[ $col ] ) {
				continue;
			}
			if ( 'what' === $col ) {
				$changes[] = null === $row[ $col ] ? 'What happened added: ' . $set[ $col ] : 'What happened: ' . ( $set[ $col ] ?? 'cleared' );
			} elseif ( null !== $list ) {
				$changes[] = "$label: " . self::shown( $cat, $list, $row[ $col ] ) . ' → ' . self::shown( $cat, $list, $set[ $col ] );
			} else {
				$changes[] = "$label: " . ( $row[ $col ] ?? 'none' ) . ' → ' . ( $set[ $col ] ?? 'none' );
			}
		}
		if ( isset( $set['occurred_at'] ) && (int) $row['occurred_at'] !== $set['occurred_at'] ) {
			$changes[] = 'Time: ' . self::manila( (int) $row['occurred_at'] ) . ' → ' . self::manila( $set['occurred_at'] );
		} else {
			unset( $set['occurred_at'] );
		}
		if ( array() === $changes ) {
			return Azl_Commands::fail( 'Nothing changed' );
		}
		return self::write( $ctx, $cmd, 'Edited', $set, mb_substr( 'Edited. ' . implode( '; ', $changes ), 0, Azl_Updates::TEXT_MAX ) );
	}

	public function link( array $cmd, Azl_Commands $ctx ): array {
		$refused = self::target( $cmd, false, $row );
		if ( null !== $refused ) {
			return $refused;
		}
		$inc = self::incident( $cmd['incidentId'] );
		if ( null === $inc ) {
			return Azl_Commands::fail( self::NO_ALERT );
		}
		if ( null !== $row['incident_id'] ) {
			return Azl_Commands::fail( $row['incident_id'] === $inc['id'] ? 'This case is already linked to that alert' : 'This case is already linked to another alert' );
		}
		return self::write( $ctx, $cmd, 'Linked to ' . self::inc_no( $inc ), array( 'incident_id' => $inc['id'] ), 'Linked to safety alert ' . self::inc_no( $inc ) );
	}

	/** The 911 call of a case with no safety alert. Set once, like the alert's (Azl_Commands::record_911). */
	public function record_911( array $cmd, Azl_Commands $ctx ): array {
		$at = Azl_Commands::iso_ms( $cmd['at'] ?? null );
		if ( null === $at ) {
			return Azl_Commands::fail( 'The call time is not a valid date' );
		}
		$refused = self::target( $cmd, false, $row );
		if ( null !== $refused ) {
			return $refused;
		}
		if ( null !== $row['incident_id'] ) {
			$inc = self::incident( $row['incident_id'] );
			return Azl_Commands::fail( 'Record the 911 call on the linked alert' . ( null === $inc ? '' : ' ' . self::inc_no( $inc ) ) );
		}
		if ( null !== $row['called911_at'] ) {
			return Azl_Commands::fail( self::LOCKED_911 );
		}
		if ( ! $ctx->claim( self::ENTITY, $row['id'], 'BFP/911 called at ' . $cmd['at'] ) ) {
			return $ctx->replay( $cmd );
		}
		$n = Azl_Db::exec(
			'UPDATE ' . Azl_Db::t( 'crisis_cases' ) . ' SET called911_by = ' . Azl_Db::literal( $ctx->actor() )
				. ', called911_at = %d, updated_at = %d WHERE id = %s AND called911_at IS NULL',
			array( $at, $ctx->now(), $row['id'] )
		);
		if ( 1 !== $n ) {
			return Azl_Commands::fail( self::LOCKED_911 );
		}
		Azl_Updates::add( self::ENTITY, $row['id'], 'BFP/911 called at ' . self::manila( $at ), $ctx->actor(), $ctx->op(), $ctx->now() );
		return Azl_Commands::ok();
	}

	/** Epoch ms as the hotel's local time (Asia/Manila), for the lines in the updates. */
	public static function manila( int $ms ): string {
		$d = ( new DateTimeImmutable( '@' . intdiv( $ms, 1000 ) ) )->setTimezone( new DateTimeZone( 'Asia/Manila' ) );
		return $d->format( 'M j, g:i A' );
	}

	/* ---------- snapshot ---------- */

	/**
	 * Every open or monitored case, and closed ones from the last 30 days; newest first. Each with its updates
	 * (names, not ids), its own 911 record and, when linked, a summary of the safety alert with the alert's 911 record.
	 */
	public function snapshot( array $who ): array {
		$c    = Azl_Db::t( 'crisis_cases' );
		$now  = Azl_Db::now();
		$rows = Azl_Db::rows(
			"SELECT * FROM $c WHERE status <> 'resolved' OR resolved_at > %d ORDER BY created_at DESC, cr_no DESC",
			array( $now - self::CLOSED_DAYS * 86400000 )
		);
		$names = array();
		foreach ( Azl_Db::rows( 'SELECT id, name FROM ' . Azl_Db::t( 'staff' ) ) as $s ) {
			$names[ $s['id'] ] = $s['name'];
		}
		$name = static function ( ?string $id ) use ( $names ): string {
			return null === $id || 'system' === $id ? Azl_Snapshot::MANAGER_SIGNER : ( $names[ $id ] ?? 'a former staff member' );
		};
		$incs = array();
		$ids  = array_values( array_unique( array_filter( array_column( $rows, 'incident_id' ) ) ) );
		if ( array() !== $ids ) {
			$found = Azl_Db::rows( 'SELECT id, inc_no, hazard, rooms, status, created_at, called911_by, called911_at FROM ' . Azl_Db::t( 'incidents' ) . ' WHERE id IN (' . Azl_Db::in( $ids ) . ')', $ids );
			foreach ( $found as $x ) {
				$incs[ $x['id'] ] = array(
					'id'        => $x['id'],
					'no'        => self::inc_no( $x ),
					'hazard'    => $x['hazard'],
					'rooms'     => Azl_Commands::rooms( $x['rooms'] ),
					'status'    => $x['status'],
					'createdAt' => (int) $x['created_at'],
					'called911' => null === $x['called911_at'] ? null : array( 'by' => $name( $x['called911_by'] ), 'at' => Azl_Snapshot::iso( (int) $x['called911_at'] ) ),
				);
			}
		}
		$updates = Azl_Updates::list( self::ENTITY, array_column( $rows, 'id' ) );
		$cases   = array();
		$counts  = array( 'active' => 0, 'monitoring' => 0, 'resolved' => 0 );
		foreach ( $rows as $r ) {
			++$counts[ $r['status'] ];
			$cases[] = array(
				'id'         => $r['id'],
				'no'         => 'CR-' . Azl_Rules::pad( (int) $r['cr_no'] ),
				'code'       => $r['code'],
				'category'   => $r['comp_cat'],
				'reportedBy' => $r['reported_by'],
				'whoType'    => $r['who_type'],
				'who'        => $r['who'],
				'location'   => $r['location'],
				'place'      => $r['place'],
				'what'       => $r['what'],
				'occurredAt' => (int) $r['occurred_at'],
				'status'     => $r['status'],
				'resolution' => $r['resolution'],
				'resolvedAt' => null === $r['resolved_at'] ? null : (int) $r['resolved_at'],
				'incidentId' => $r['incident_id'],
				'incident'   => null === $r['incident_id'] ? null : ( $incs[ $r['incident_id'] ] ?? null ),
				'called911'  => null === $r['called911_at'] ? null : array( 'by' => $name( $r['called911_by'] ), 'at' => Azl_Snapshot::iso( (int) $r['called911_at'] ) ),
				'loggedBy'   => $name( $r['logged_by'] ),
				'createdAt'  => (int) $r['created_at'],
				'updates'    => array_map(
					static function ( $u ) use ( $name ) {
						return array( 'at' => $u['at'], 'by' => $name( $u['by'] ), 'text' => $u['text'] );
					},
					$updates[ $r['id'] ] ?? array()
				),
			);
		}
		return array(
			'cases'  => $cases,
			'counts' => $counts + array( 'unresolved' => $counts['active'] + $counts['monitoring'] ),
		);
	}
}

Azl_Modules::register( new Azl_Module_Crisis() );
