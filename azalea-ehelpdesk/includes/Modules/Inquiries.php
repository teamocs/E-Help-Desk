<?php
/**
 * Inquiries (sidebar module 3): questions from in-house guests, outside callers and checked-out guests, logged and
 * closed quickly. The client prototype's module (docs/MODULES-SPEC.md A.5), built on the module framework.
 *
 * Table azl_inquiries; numbers I-0001 from the counter `inq`. Commands: logInquiry, noteInquiry, closeInquiry,
 * reopenInquiry (Undo). Each runs in one transaction with the op-id claim (events), so a resend never applies twice
 * and a refusal never uses a number. Statuses: active -> noted; active or noted -> done; Undo: noted or done -> active.
 * Closing within 6 minutes of logging sets quick_close (the prototype's "<=6m" flag).
 *
 * Who: owner, manager, supervisor and the help-desk officer have full access; department staff have none (Azl_Access).
 *
 * @package azl-ehd
 */

defined( 'ABSPATH' ) || exit;

final class Azl_Module_Inquiries extends Azl_Module {

	const TYPES       = array( 'in_house', 'external', 'checked_out' );
	/** Closed within this long after logging: the quick-close flag (6 minutes, as the prototype). */
	const QUICK_MS    = 360000;
	/** The snapshot carries every open inquiry plus the ones changed in this many days. */
	const WINDOW_DAYS = 14;
	const CAP         = 500;

	public function id(): string {
		return 'inquiries';
	}

	public function version(): string {
		return '1';
	}

	public function schema() {
		return 'CREATE TABLE ' . Azl_Db::t( 'inquiries' ) . " (
  id char(36) NOT NULL,
  inq_no int(11) unsigned NOT NULL,
  contact_name varchar(120) NOT NULL,
  contact_type varchar(12) NOT NULL,
  room varchar(40) DEFAULT NULL,
  descr text NOT NULL,
  hdo char(36) DEFAULT NULL,
  status varchar(10) NOT NULL DEFAULT 'active',
  closed_at bigint(20) DEFAULT NULL,
  quick_close tinyint(1) NOT NULL DEFAULT 0,
  logged_by char(36) DEFAULT NULL,
  op_id char(36) NOT NULL,
  created_at bigint(20) NOT NULL,
  updated_at bigint(20) NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY inq_no (inq_no),
  UNIQUE KEY op_id (op_id),
  KEY status_created (status,created_at),
  KEY updated_at (updated_at)
) " . Azl_Schema::table_options() . ';';
	}

	public function sequences(): array {
		return array( 'inq' );
	}

	public function commands(): array {
		return array(
			'logInquiry'     => array(
				'ids'      => array( 'inquiryId' ),
				'validate' => array( $this, 'validate_log' ),
				'run'      => array( $this, 'log' ),
				'prior'    => array( $this, 'prior' ),
			),
			'noteInquiry'    => array(
				'ids' => array( 'inquiryId' ),
				'run' => function ( array $cmd, Azl_Commands $ctx ): array {
					return $this->step( $cmd, $ctx, array( 'active' ), 'noted', 'Noted', 'Already noted or closed' );
				},
			),
			'closeInquiry'   => array(
				'ids' => array( 'inquiryId' ),
				'run' => function ( array $cmd, Azl_Commands $ctx ): array {
					return $this->step( $cmd, $ctx, array( 'active', 'noted' ), 'done', 'Closed', 'Already closed' );
				},
			),
			'reopenInquiry'  => array(
				'ids' => array( 'inquiryId' ),
				'run' => function ( array $cmd, Azl_Commands $ctx ): array {
					return $this->step( $cmd, $ctx, array( 'noted', 'done' ), 'active', 'Reopened', 'Already open' );
				},
			),
		);
	}

	/* ---------- validation (before any write) ---------- */

	public function validate_log( array $cmd ): ?string {
		if ( ! is_string( $cmd['contactType'] ?? null ) || ! in_array( $cmd['contactType'], self::TYPES, true ) ) {
			return 'Choose who is asking: in-house guest, external or checked-out guest';
		}
		$name = Azl_Commands::line( $cmd['name'] ?? null );
		if ( '' === $name ) {
			return 'Enter the name of who is asking';
		}
		if ( mb_strlen( $name ) > Azl_Commands::NAME_MAX ) {
			return 'Keep the name under ' . Azl_Commands::NAME_MAX . ' characters';
		}
		if ( mb_strlen( Azl_Commands::line( $cmd['room'] ?? null ) ) > Azl_Commands::ROOM_MAX ) {
			return 'Keep the room under ' . Azl_Commands::ROOM_MAX . ' characters';
		}
		$desc = Azl_Commands::para( $cmd['desc'] ?? null );
		if ( '' === $desc ) {
			return 'Describe the inquiry';
		}
		if ( mb_strlen( $desc ) > Azl_Commands::TEXT_MAX ) {
			return 'Keep the description under ' . Azl_Commands::TEXT_MAX . ' characters';
		}
		if ( null !== ( $cmd['hdo'] ?? null ) && null === self::officer( $cmd['hdo'] ) ) {
			return 'Choose a help desk officer from the list';
		}
		return null;
	}

	/** The id of an active help-desk officer, lower-cased, or null. */
	private static function officer( $id ): ?string {
		if ( ! Azl_Db::is_uuid( $id ) ) {
			return null;
		}
		$id   = strtolower( $id );
		$role = Azl_Db::val( 'SELECT role FROM ' . Azl_Db::t( 'staff' ) . ' WHERE id = %s AND active = 1', array( $id ) );
		return 'hdo' === $role ? $id : null;
	}

	/* ---------- commands ---------- */

	public function log( array $cmd, Azl_Commands $ctx ): array {
		$t = Azl_Db::t( 'inquiries' );
		if ( null !== Azl_Db::val( "SELECT id FROM $t WHERE id = %s", array( $cmd['inquiryId'] ) ) ) {
			return Azl_Commands::fail( 'This inquiry was already logged' );
		}
		// The officer on duty: the one chosen, else the person logging it when they are an officer.
		$hdo  = isset( $cmd['hdo'] ) ? self::officer( $cmd['hdo'] ) : ( null === $ctx->actor() ? null : self::officer( $ctx->actor() ) );
		$room = Azl_Commands::line( $cmd['room'] ?? null );
		if ( ! $ctx->claim( 'inquiry', $cmd['inquiryId'], 'Logged' ) ) {
			return $ctx->replay( $cmd );
		}
		$n = Azl_Db::bump( 'inq' );
		Azl_Db::insert(
			'inquiries',
			array(
				'id'           => $cmd['inquiryId'],
				'inq_no'       => $n,
				'contact_name' => Azl_Commands::line( $cmd['name'] ),
				'contact_type' => $cmd['contactType'],
				'room'         => '' === $room ? null : $room,
				'descr'        => Azl_Commands::para( $cmd['desc'] ),
				'hdo'          => $hdo,
				'status'       => 'active',
				'quick_close'  => 0,
				'logged_by'    => $ctx->actor(),
				'op_id'        => $ctx->op(),
				'created_at'   => $ctx->now(),
				'updated_at'   => $ctx->now(),
			)
		);
		return Azl_Commands::ok( array( 'inquiryNo' => $n ) );
	}

	/** The number of a logged inquiry, for a replayed logInquiry. */
	public function prior( string $id ): array {
		$n = Azl_Db::val( 'SELECT inq_no FROM ' . Azl_Db::t( 'inquiries' ) . ' WHERE id = %s', array( $id ) );
		return null === $n ? array() : array( 'inquiryNo' => (int) $n );
	}

	/** Note, close or reopen: one step from a set of statuses to another. */
	private function step( array $cmd, Azl_Commands $ctx, array $from, string $to, string $label, string $already ): array {
		$row = Azl_Db::row( 'SELECT status, created_at FROM ' . Azl_Db::t( 'inquiries' ) . ' WHERE id = %s' . Azl_Db::lock(), array( $cmd['inquiryId'] ) );
		if ( null === $row ) {
			return Azl_Commands::fail( 'Unknown inquiry' );
		}
		if ( ! in_array( $row['status'], $from, true ) ) {
			return Azl_Commands::fail( $already );
		}
		if ( ! $ctx->claim( 'inquiry', $cmd['inquiryId'], $label ) ) {
			return $ctx->replay( $cmd );
		}
		$set = array( 'status' => $to, 'updated_at' => $ctx->now(), 'closed_at' => null, 'quick_close' => 0 );
		if ( 'done' === $to ) {
			$set['closed_at']   = $ctx->now();
			$set['quick_close'] = $ctx->now() - (int) $row['created_at'] <= self::QUICK_MS ? 1 : 0;
		}
		Azl_Db::update( 'inquiries', $set, array( 'id' => $cmd['inquiryId'] ) );
		return Azl_Commands::ok();
	}

	/* ---------- snapshot ---------- */

	/**
	 * { list: every open inquiry plus the ones changed in the last 14 days (newest first, at most 500), counts: the
	 * badge numbers over ALL rows, so the badge is right even when the list is cut }.
	 */
	public function snapshot( array $who ): array {
		$t     = Azl_Db::t( 'inquiries' );
		$since = Azl_Db::now() - self::WINDOW_DAYS * 86400000;
		$rows  = Azl_Db::rows(
			"SELECT id, inq_no, contact_name, contact_type, room, descr, hdo, status, closed_at, quick_close, created_at FROM $t
			  WHERE status <> 'done' OR updated_at > %d ORDER BY created_at DESC, id DESC LIMIT %d",
			array( $since, self::CAP )
		);
		$count = array( 'active' => 0, 'noted' => 0 );
		foreach ( Azl_Db::rows( "SELECT status, COUNT(*) AS n FROM $t WHERE status IN ('active', 'noted') GROUP BY status" ) as $c ) {
			$count[ $c['status'] ] = (int) $c['n'];
		}
		$history = array();
		foreach ( array_chunk( array_column( $rows, 'id' ), 500 ) as $chunk ) {
			foreach ( Azl_Db::rows(
				'SELECT entity_id, what, by_staff, created_at FROM ' . Azl_Db::t( 'events' ) . " WHERE entity = 'inquiry' AND entity_id IN (" . Azl_Db::in( $chunk ) . ') ORDER BY created_at, id',
				$chunk
			) as $e ) {
				$history[ $e['entity_id'] ][] = array( 'at' => (int) $e['created_at'], 'by' => $e['by_staff'] ?? 'system', 'what' => $e['what'] );
			}
		}
		$list = array();
		foreach ( $rows as $r ) {
			$list[] = array_filter(
				array(
					'id'        => $r['id'],
					'no'        => 'I-' . Azl_Rules::pad( (int) $r['inq_no'] ),
					'name'      => $r['contact_name'],
					'type'      => $r['contact_type'],
					'room'      => $r['room'],
					'desc'      => $r['descr'],
					'hdo'       => $r['hdo'],
					'status'    => $r['status'],
					'createdAt' => (int) $r['created_at'],
					'closedAt'  => null === $r['closed_at'] ? null : (int) $r['closed_at'],
					'quick'     => '1' === (string) $r['quick_close'],
					'history'   => $history[ $r['id'] ] ?? array(),
				),
				static function ( $v ) {
					return null !== $v;
				}
			);
		}
		return array( 'list' => $list, 'counts' => $count );
	}
}

Azl_Modules::register( new Azl_Module_Inquiries() );
