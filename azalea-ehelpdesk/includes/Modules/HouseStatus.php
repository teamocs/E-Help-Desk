<?php
/**
 * House Status (sidebar id housestatus): a running log of building-wide conditions (low water pressure, an outage)
 * with timed updates until it is closed. The client prototype's module 6 (docs/MODULES-SPEC.md A.8).
 *
 * Table azl_house_logs; numbers HS-0001 from the azl_seq counter 'hs'; every progress note is an azl_updates row
 * (entity house_log). Commands: logHouse, updateHouse, closeHouse, reopenHouse, editHouse. Statuses: monitoring,
 * pending, closed; Edit may move a log between any two. Access is the matrix row in Azl_Access: the help desk and
 * managers change logs, department staff only read them.
 *
 * @package azl-ehd
 */

defined( 'ABSPATH' ) || exit;

final class Azl_Module_HouseStatus extends Azl_Module {

	const STATUSES = array( 'monitoring', 'pending', 'closed' );
	/** Closed logs stay in the snapshot this long after their last change; logs that are not closed always do. */
	const CLOSED_DAYS = 30;
	const CLOSED_CAP  = 200;
	const TEXT_MAX    = 2000;

	public function id(): string {
		return 'housestatus';
	}

	public function schema() {
		return 'CREATE TABLE ' . Azl_Db::t( 'house_logs' ) . " (
  id char(36) NOT NULL,
  hs_no int(11) unsigned NOT NULL,
  narration text NOT NULL,
  status varchar(12) NOT NULL DEFAULT 'monitoring',
  logged_by char(36) DEFAULT NULL,
  closed_at bigint(20) DEFAULT NULL,
  op_id char(36) NOT NULL,
  created_at bigint(20) NOT NULL,
  updated_at bigint(20) NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY hs_no (hs_no),
  UNIQUE KEY op_id (op_id),
  KEY status_created (status,created_at),
  KEY updated_at (updated_at)
) " . Azl_Schema::table_options() . ';';
	}

	public function sequences(): array {
		return array( 'hs' );
	}

	public function commands(): array {
		$prior = static function ( string $id ): array {
			$n = Azl_Db::val( 'SELECT hs_no FROM ' . Azl_Db::t( 'house_logs' ) . ' WHERE id = %s', array( $id ) );
			return null === $n ? array() : array( 'hsNo' => (int) $n );
		};
		return array(
			'logHouse'    => array( 'ids' => array( 'houseId' ), 'validate' => array( $this, 'check_log' ), 'run' => array( $this, 'log' ), 'prior' => $prior ),
			'updateHouse' => array( 'ids' => array( 'houseId' ), 'validate' => array( $this, 'check_update' ), 'run' => array( $this, 'update' ) ),
			'closeHouse'  => array( 'ids' => array( 'houseId' ), 'validate' => array( $this, 'check_close' ), 'run' => array( $this, 'close' ) ),
			'reopenHouse' => array( 'ids' => array( 'houseId' ), 'run' => array( $this, 'reopen' ) ),
			'editHouse'   => array( 'ids' => array( 'houseId' ), 'validate' => array( $this, 'check_edit' ), 'run' => array( $this, 'edit' ) ),
		);
	}

	/* ---------- validation: plain-language problems, before anything is written ---------- */

	private static function narration( array $cmd ): ?string {
		$t = Azl_Commands::para( $cmd['narration'] ?? null );
		if ( '' === $t ) {
			return 'Incident narration is required.';
		}
		return mb_strlen( $t ) > self::TEXT_MAX ? 'Keep the narration under ' . self::TEXT_MAX . ' characters.' : null;
	}

	public function check_log( array $cmd ): ?string {
		if ( ! in_array( $cmd['status'] ?? null, array( 'monitoring', 'pending' ), true ) ) {
			return 'Choose Monitoring or Pending.';
		}
		return self::narration( $cmd );
	}

	public function check_update( array $cmd ): ?string {
		$t = Azl_Commands::para( $cmd['text'] ?? null );
		if ( '' === $t ) {
			return 'Update is required.';
		}
		return mb_strlen( $t ) > self::TEXT_MAX ? 'Keep the update under ' . self::TEXT_MAX . ' characters.' : null;
	}

	public function check_close( array $cmd ): ?string {
		$t = Azl_Commands::para( $cmd['note'] ?? '' );
		return mb_strlen( $t ) > self::TEXT_MAX - 2 ? 'Keep the closing note under ' . ( self::TEXT_MAX - 2 ) . ' characters.' : null;
	}

	public function check_edit( array $cmd ): ?string {
		if ( ! in_array( $cmd['status'] ?? null, self::STATUSES, true ) ) {
			return 'Choose Monitoring, Pending or Closed.';
		}
		return self::narration( $cmd );
	}

	/* ---------- commands ---------- */

	private static function locked( string $id ): ?array {
		return Azl_Db::row( 'SELECT * FROM ' . Azl_Db::t( 'house_logs' ) . ' WHERE id = %s' . Azl_Db::lock(), array( $id ) );
	}

	public function log( array $cmd, Azl_Commands $ctx ): array {
		if ( null !== self::locked( $cmd['houseId'] ) ) {
			return Azl_Commands::fail( 'This log already exists.' );
		}
		if ( ! $ctx->claim( 'house_log', $cmd['houseId'], 'Logged' ) ) {
			return $ctx->replay( $cmd );
		}
		$n   = Azl_Db::bump( 'hs' );
		$row = array(
			'id'         => $cmd['houseId'],
			'hs_no'      => $n,
			'narration'  => Azl_Commands::para( $cmd['narration'] ),
			'status'     => $cmd['status'],
			'op_id'      => $ctx->op(),
			'created_at' => $ctx->now(),
			'updated_at' => $ctx->now(),
		);
		if ( null !== $ctx->actor() ) {
			$row['logged_by'] = $ctx->actor();
		}
		Azl_Db::insert( 'house_logs', $row );
		return Azl_Commands::ok( array( 'hsNo' => $n ) );
	}

	public function update( array $cmd, Azl_Commands $ctx ): array {
		$log = self::locked( $cmd['houseId'] );
		if ( null === $log ) {
			return Azl_Commands::fail( 'Unknown log' );
		}
		if ( 'closed' === $log['status'] ) {
			return Azl_Commands::fail( 'This log is closed. Reopen it to add an update.' );
		}
		if ( ! $ctx->claim( 'house_log', $log['id'], 'Update added' ) ) {
			return $ctx->replay( $cmd );
		}
		Azl_Updates::add( 'house_log', $log['id'], Azl_Commands::para( $cmd['text'] ), $ctx->actor(), $ctx->op(), $ctx->now() );
		Azl_Db::update( 'house_logs', array( 'updated_at' => $ctx->now() ), array( 'id' => $log['id'] ) );
		return Azl_Commands::ok();
	}

	public function close( array $cmd, Azl_Commands $ctx ): array {
		$log = self::locked( $cmd['houseId'] );
		if ( null === $log ) {
			return Azl_Commands::fail( 'Unknown log' );
		}
		if ( 'closed' === $log['status'] ) {
			return Azl_Commands::fail( 'This log is already closed.' );
		}
		if ( ! $ctx->claim( 'house_log', $log['id'], 'Closed' ) ) {
			return $ctx->replay( $cmd );
		}
		$note = Azl_Commands::para( $cmd['note'] ?? '' );
		Azl_Updates::add( 'house_log', $log['id'], '' === $note ? 'Closed' : 'Closed: ' . $note, $ctx->actor(), $ctx->op(), $ctx->now() );
		Azl_Db::update( 'house_logs', array( 'status' => 'closed', 'closed_at' => $ctx->now(), 'updated_at' => $ctx->now() ), array( 'id' => $log['id'] ) );
		return Azl_Commands::ok();
	}

	public function reopen( array $cmd, Azl_Commands $ctx ): array {
		$log = self::locked( $cmd['houseId'] );
		if ( null === $log ) {
			return Azl_Commands::fail( 'Unknown log' );
		}
		if ( 'closed' !== $log['status'] ) {
			return Azl_Commands::fail( 'This log is not closed.' );
		}
		if ( ! $ctx->claim( 'house_log', $log['id'], 'Reopened' ) ) {
			return $ctx->replay( $cmd );
		}
		Azl_Updates::add( 'house_log', $log['id'], 'Reopened', $ctx->actor(), $ctx->op(), $ctx->now() );
		Azl_Db::exec( 'UPDATE ' . Azl_Db::t( 'house_logs' ) . " SET status = 'monitoring', closed_at = NULL, updated_at = %d WHERE id = %s", array( $ctx->now(), $log['id'] ) );
		return Azl_Commands::ok();
	}

	public function edit( array $cmd, Azl_Commands $ctx ): array {
		$log = self::locked( $cmd['houseId'] );
		if ( null === $log ) {
			return Azl_Commands::fail( 'Unknown log' );
		}
		$text   = Azl_Commands::para( $cmd['narration'] );
		$status = $cmd['status'];
		$what   = array();
		if ( $text !== $log['narration'] ) {
			$what[] = 'narration changed';
		}
		if ( $status !== $log['status'] ) {
			$what[] = 'status ' . $log['status'] . ' to ' . $status;
		}
		if ( array() === $what ) {
			return Azl_Commands::fail( 'Nothing was changed.' );
		}
		if ( ! $ctx->claim( 'house_log', $log['id'], 'Edited' ) ) {
			return $ctx->replay( $cmd );
		}
		// One history line per edit (azl_updates keeps one note per op and record).
		Azl_Updates::add( 'house_log', $log['id'], 'Edited: ' . implode( ', ', $what ), $ctx->actor(), $ctx->op(), $ctx->now() );
		// closed_at: kept while it stays closed, set when it closes, cleared when it opens again.
		$closed_at = 'closed' !== $status ? 'NULL' : ( null !== $log['closed_at'] ? (string) (int) $log['closed_at'] : (string) $ctx->now() );
		Azl_Db::exec(
			'UPDATE ' . Azl_Db::t( 'house_logs' ) . ' SET narration = %s, status = %s, closed_at = ' . $closed_at . ', updated_at = %d WHERE id = %s',
			array( $text, $status, $ctx->now(), $log['id'] )
		);
		return Azl_Commands::ok();
	}

	/* ---------- snapshot ---------- */

	public function snapshot( array $who ): array {
		$t      = Azl_Db::t( 'house_logs' );
		$open   = Azl_Db::rows( "SELECT * FROM $t WHERE status <> 'closed'" );
		$closed = Azl_Db::rows(
			"SELECT * FROM $t WHERE status = 'closed' AND updated_at > %d ORDER BY created_at DESC, id DESC LIMIT %d",
			array( Azl_Db::now() - self::CLOSED_DAYS * 86400000, self::CLOSED_CAP )
		);
		$rows   = array_merge( $open, $closed );
		usort(
			$rows,
			static function ( $a, $b ) {
				return array( (int) $b['created_at'], $b['id'] ) <=> array( (int) $a['created_at'], $a['id'] );
			}
		);
		$updates = Azl_Updates::list( 'house_log', array_column( $rows, 'id' ) );
		$logs    = array();
		foreach ( $rows as $r ) {
			$log = array(
				'id'        => $r['id'],
				'no'        => 'HS-' . Azl_Rules::pad( (int) $r['hs_no'] ),
				'narration' => $r['narration'],
				'status'    => $r['status'],
				'loggedBy'  => $r['logged_by'] ?? '',
				'createdAt' => (int) $r['created_at'],
				'updates'   => $updates[ $r['id'] ] ?? array(),
			);
			if ( null !== $r['closed_at'] ) {
				$log['closedAt'] = (int) $r['closed_at'];
			}
			$logs[] = $log;
		}
		// The sidebar badge: logs not closed (the prototype's rule).
		return array( 'logs' => $logs, 'open' => count( $open ) );
	}
}

Azl_Modules::register( new Azl_Module_HouseStatus() );
