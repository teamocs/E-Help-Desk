<?php
/**
 * Port of src/server/snapshot.ts. Builds the Snapshot of src/server/contract.ts with the same field
 * names, so the existing client store works unchanged. Optional fields that are empty are left out
 * (as JSON.stringify drops undefined), never sent as null.
 *
 * Additions: `rev`, the change counter at read time, which the client can pass to /poll?since=, and
 * `catalog`, the hotel's lists (Azl_Catalog).
 *
 * @package azl-ehd
 */

defined( 'ABSPATH' ) || exit;

final class Azl_Snapshot {

	/** Requests younger than this are always sent; older ones only while one of their items is open. */
	const REQUEST_HOURS = 48;
	const REQUEST_CAP   = 500;
	/** Done work orders and done cleaning drop out after this long without activity. */
	const WO_DONE_DAYS      = 14;
	const CLEAN_DONE_HOURS  = 24;
	/** Incidents that are no longer active drop out after this long. */
	const INCIDENT_DAYS = 7;
	/** Who signed or called when no staff member was signed in with a PIN (a manager account). */
	const MANAGER_SIGNER = 'a manager';

	const PROPERTY_OPTION = 'azl_property_id';

	/** This site's property: a stable id made on first use, and the name from the settings. */
	public static function property(): array {
		$id = get_option( self::PROPERTY_OPTION );
		if ( ! Azl_Db::is_uuid( $id ) ) {
			$id = Azl_Db::uuid();
			if ( ! add_option( self::PROPERTY_OPTION, $id, '', true ) ) {
				$id = (string) get_option( self::PROPERTY_OPTION );
			}
		}
		$settings = get_option( 'azl_settings' );
		$name     = is_array( $settings ) && ! empty( $settings['property_name'] ) && is_string( $settings['property_name'] )
			? $settings['property_name']
			: wp_specialchars_decode( (string) get_bloginfo( 'name' ), ENT_QUOTES );
		return array( 'id' => $id, 'name' => $name );
	}

	public static function load(): array {
		$now      = Azl_Db::now();
		$rev      = Azl_Db::counter( 'change' ); // read first: a write landing during the read only causes one extra refresh
		$property = self::property();
		list( $requests, $items ) = self::requests( $now );
		return array(
			'property'   => $property,
			'properties' => array( $property ),
			'staff'      => self::staff(),
			'requests'   => $requests,
			'items'      => (object) $items,
			'wos'        => self::work_orders( $now ),
			'cleaning'   => self::cleaning( $now ),
			'incidents'  => self::incidents( $now ),
			'handover'   => self::handover(),
			'seq'        => array(
				't'   => Azl_Db::counter( 'ticket' ),
				'wo'  => Azl_Db::counter( 'wo' ),
				'inc' => Azl_Db::counter( 'inc' ),
				'id'  => 0,
			),
			'at'         => $now,
			'rev'        => $rev,
			// The hotel's lists. A save bumps the change counter, so every phone gets them on its next poll.
			'catalog'    => Azl_Catalog::get(),
		);
	}

	/** Drops the keys whose value is null. */
	private static function opt( array $a ): array {
		return array_filter(
			$a,
			static function ( $v ) {
				return null !== $v;
			}
		);
	}

	private static function int_or_null( $v ): ?int {
		return null === $v ? null : (int) $v;
	}

	private static function float_or_null( $v ): ?float {
		return null === $v ? null : (float) $v;
	}

	private static function staff(): array {
		$rows = Azl_Db::rows(
			'SELECT id, name, initials, role, title, dept, on_shift FROM ' . Azl_Db::t( 'staff' ) . ' WHERE active = 1 ORDER BY created_at, id'
		);
		$out  = array();
		foreach ( $rows as $s ) {
			$out[] = self::opt(
				array(
					'id'       => $s['id'],
					'name'     => $s['name'],
					'initials' => $s['initials'],
					'role'     => $s['role'],
					'title'    => $s['title'],
					'dept'     => $s['dept'],
					'onShift'  => '1' === (string) $s['on_shift'],
				)
			);
		}
		return $out;
	}

	/**
	 * History rows for many entities at once, keyed by entity id, oldest first.
	 *
	 * @return array<string, array<int, array{at: int, by: string, what: string}>>
	 */
	private static function logs( string $entity, array $ids ): array {
		$out = array();
		foreach ( array_chunk( $ids, 500 ) as $chunk ) {
			$rows = Azl_Db::rows(
				'SELECT entity_id, what, by_staff, created_at FROM ' . Azl_Db::t( 'events' ) . ' WHERE entity = %s AND entity_id IN ('
					. Azl_Db::in( $chunk ) . ') ORDER BY created_at, id',
				array_merge( array( $entity ), $chunk )
			);
			foreach ( $rows as $e ) {
				$out[ $e['entity_id'] ][] = array(
					'at'   => (int) $e['created_at'],
					'by'   => $e['by_staff'] ?? 'system',
					'what' => $e['what'],
				);
			}
		}
		return $out;
	}

	private static function requests( int $now ): array {
		$r    = Azl_Db::t( 'requests' );
		$i    = Azl_Db::t( 'items' );
		$open = Azl_Rules::OPEN_STATUSES;
		$reqs = Azl_Db::rows(
			"SELECT id, ticket_no, room, source, remarks, logged_by, created_at, incomplete, vip, safety_id FROM $r r
			  WHERE r.created_at > %d
			     OR EXISTS (SELECT 1 FROM $i x WHERE x.request_id = r.id AND x.status IN (" . Azl_Db::in( $open ) . '))
			  ORDER BY r.created_at DESC, r.id DESC
			  LIMIT %d',
			array_merge( array( $now - self::REQUEST_HOURS * 3600000 ), $open, array( self::REQUEST_CAP ) )
		);
		$rows = array();
		foreach ( array_chunk( array_column( $reqs, 'id' ), 500 ) as $chunk ) {
			$rows = array_merge(
				$rows,
				Azl_Db::rows( "SELECT * FROM $i WHERE request_id IN (" . Azl_Db::in( $chunk ) . ')', $chunk )
			);
		}
		usort(
			$rows,
			static function ( $a, $b ) {
				return array( (int) $a['created_at'], (int) $a['pos'], $a['id'] ) <=> array( (int) $b['created_at'], (int) $b['pos'], $b['id'] );
			}
		);
		$logs     = self::logs( 'item', array_column( $rows, 'id' ) );
		$items    = array();
		$by_req   = array();
		foreach ( $rows as $x ) {
			$items[ $x['id'] ]              = self::item( $x, $logs[ $x['id'] ] ?? array() );
			$by_req[ $x['request_id'] ][] = $x['id'];
		}
		$requests = array();
		foreach ( $reqs as $q ) {
			$requests[] = self::opt(
				array(
					'id'         => $q['id'],
					'ticket'     => 'T-' . Azl_Rules::pad( (int) $q['ticket_no'] ),
					'room'       => $q['room'],
					'source'     => $q['source'],
					'remarks'    => $q['remarks'],
					'loggedBy'   => $q['logged_by'] ?? '',
					'createdAt'  => (int) $q['created_at'],
					'itemIds'    => $by_req[ $q['id'] ] ?? array(),
					'incomplete' => '1' === (string) $q['incomplete'],
					'vip'        => '1' === (string) $q['vip'],
					'safetyId'   => $q['safety_id'],
				)
			);
		}
		return array( $requests, $items );
	}

	private static function item( array $i, array $events ): array {
		return self::opt(
			array(
				'id'          => $i['id'],
				'requestId'   => $i['request_id'],
				'name'        => $i['name'],
				'qty'         => (int) $i['qty'],
				'dept'        => $i['dept'],
				'assignee'    => $i['assignee'],
				'status'      => $i['status'],
				'holdReason'  => $i['hold_reason'],
				'createdAt'   => (int) $i['created_at'],
				'ackAt'       => self::int_or_null( $i['ack_at'] ),
				'doneAt'      => self::int_or_null( $i['done_at'] ),
				'holdSince'   => self::int_or_null( $i['hold_since'] ),
				'heldMs'      => (int) $i['held_ms'],
				'slaMin'      => (int) $i['sla_min'],
				'dependsOn'   => $i['depends_on'],
				'xFrom'       => $i['x_from'],
				'woId'        => $i['wo_id'],
				'stBeforeEsc' => $i['st_before_esc'],
				'events'      => $events,
			)
		);
	}

	private static function work_orders( int $now ): array {
		$w     = Azl_Db::t( 'work_orders' );
		$e     = Azl_Db::t( 'events' );
		$since = $now - self::WO_DONE_DAYS * 86400000;
		$rows  = Azl_Db::rows(
			"SELECT * FROM $w w
			  WHERE w.status <> 'done' OR w.created_at > %d
			     OR EXISTS (SELECT 1 FROM $e e WHERE e.entity = 'work_order' AND e.entity_id = w.id AND e.created_at > %d)
			  ORDER BY w.created_at DESC, w.id DESC",
			array( $since, $since )
		);
		$logs  = self::logs( 'work_order', array_column( $rows, 'id' ) );
		$out   = array();
		foreach ( $rows as $x ) {
			$out[] = self::opt(
				array(
					'id'         => $x['id'],
					'no'         => 'WO-' . Azl_Rules::pad( (int) $x['wo_no'] ),
					'area'       => $x['area'],
					'loc'        => $x['loc'],
					'desc'       => $x['descr'],
					'priority'   => $x['priority'],
					'dept'       => $x['dept'],
					'status'     => $x['status'],
					'reportedBy' => $x['reported_by'] ?? '',
					'encodedBy'  => $x['encoded_by'] ?? '',
					'createdAt'  => (int) $x['created_at'],
					'assessment' => $x['assessment'],
					'assignType' => $x['assign_type'],
					'contractor' => $x['contractor'],
					'estCost'    => self::float_or_null( $x['est_cost'] ),
					'actualCost' => self::float_or_null( $x['actual_cost'] ),
					'targetEnd'  => self::int_or_null( $x['target_end'] ),
					'srcItemId'  => $x['src_item_id'],
					'audit'      => $logs[ $x['id'] ] ?? array(),
				)
			);
		}
		return $out;
	}

	private static function cleaning( int $now ): array {
		$c     = Azl_Db::t( 'clean_tasks' );
		$e     = Azl_Db::t( 'events' );
		$since = $now - self::CLEAN_DONE_HOURS * 3600000;
		$rows  = Azl_Db::rows(
			"SELECT id, room, type, status, assignee FROM $c c
			  WHERE c.status <> 'done' OR c.created_at > %d
			     OR EXISTS (SELECT 1 FROM $e e WHERE e.entity = 'clean_task' AND e.entity_id = c.id AND e.created_at > %d)
			  ORDER BY c.room, c.created_at",
			array( $since, $since )
		);
		$out   = array();
		foreach ( $rows as $x ) {
			$out[] = self::opt(
				array(
					'id'       => $x['id'],
					'room'     => $x['room'],
					'type'     => $x['type'],
					'status'   => $x['status'],
					'assignee' => $x['assignee'],
				)
			);
		}
		return $out;
	}

	private static function handover() {
		$h   = Azl_Db::t( 'handovers' );
		$s   = Azl_Db::t( 'staff' );
		$row = Azl_Db::row( "SELECT h.created_at, s.name FROM $h h LEFT JOIN $s s ON s.id = h.signed_by ORDER BY h.created_at DESC, h.id DESC LIMIT 1" );
		if ( null === $row ) {
			return new stdClass();
		}
		return array( 'ackBy' => $row['name'] ?? self::MANAGER_SIGNER, 'ackAt' => (int) $row['created_at'] );
	}

	/** Epoch ms to an ISO string like JavaScript's toISOString(). */
	public static function iso( int $ms ): string {
		$d = DateTimeImmutable::createFromFormat( 'U', (string) intdiv( $ms, 1000 ), new DateTimeZone( 'UTC' ) );
		return $d->format( 'Y-m-d\TH:i:s' ) . sprintf( '.%03dZ', $ms % 1000 );
	}

	private static function incidents( int $now ): array {
		$i    = Azl_Db::t( 'incidents' );
		$s    = Azl_Db::t( 'staff' );
		$rows = Azl_Db::rows(
			"SELECT i.id, i.inc_no, i.hazard, i.rooms, i.created_at, i.report, i.status, s.name AS called_by, i.called911_at
			   FROM $i i LEFT JOIN $s s ON s.id = i.called911_by
			  WHERE i.status = 'active' OR i.created_at > %d
			  ORDER BY i.created_at DESC, i.id DESC",
			array( $now - self::INCIDENT_DAYS * 86400000 )
		);
		$logs = self::logs( 'incident', array_column( $rows, 'id' ) );
		$out  = array();
		foreach ( $rows as $x ) {
			$out[] = self::opt(
				array(
					'id'        => $x['id'],
					'no'        => 'INC-' . Azl_Rules::pad( (int) $x['inc_no'], 3 ),
					'hazard'    => $x['hazard'],
					'rooms'     => Azl_Commands::rooms( $x['rooms'] ),
					'createdAt' => (int) $x['created_at'],
					'text'      => $x['report'],
					'status'    => $x['status'],
					'called911' => null === $x['called911_at']
						? null
						: array( 'by' => $x['called_by'] ?? self::MANAGER_SIGNER, 'at' => self::iso( (int) $x['called911_at'] ) ),
					'log'       => $logs[ $x['id'] ] ?? array(),
				)
			);
		}
		return $out;
	}
}
