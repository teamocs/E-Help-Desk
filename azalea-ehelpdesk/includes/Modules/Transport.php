<?php
/**
 * Transport (sidebar id transport; the prototype calls the page "Transport Log"): hotel vehicle trips, logged as they
 * leave or scheduled ahead, then departed and arrived. The client prototype's module 8 (docs/MODULES-SPEC.md A.10).
 *
 * Table azl_trips; numbers TR-0001 from the azl_seq counter 'tr'; the vehicles are the editable list "vehicles"
 * (Configuration, Lists). A trip keeps the vehicle's NAME as it was when the trip was made, so renaming or removing a
 * vehicle later never changes the log. The driver is free text (the prototype has no drivers list).
 *
 * Commands: logTrip (leaves now), scheduleTrip, departTrip, arriveTrip, plus editTrip (scheduled or en route) and
 * cancelTrip (scheduled), which the prototype lacks. Statuses: scheduled, en_route, arrived, cancelled.
 *
 * Access: the help desk and managers do everything. Department staff on a shared phone ("own") are drivers: they may
 * depart and arrive a trip whose driver is their own name, nothing else. Scheduled times are the hotel's local time
 * (Asia/Manila) and are stored as one UTC moment (sched_at), so "today" is never a UTC date.
 *
 * @package azl-ehd
 */

defined( 'ABSPATH' ) || exit;

final class Azl_Module_Transport extends Azl_Module {

	const TZ         = 'Asia/Manila';
	const STATUSES   = array( 'scheduled', 'en_route', 'arrived', 'cancelled' );
	/** Arrived and cancelled trips stay in the snapshot this long; trips still to run or on the road always do. */
	const DONE_DAYS  = 14;
	const CAP        = 300;
	const DRIVER_MAX = 120;
	const TEXT_MAX   = 160;
	const DESK_ONLY  = 'Only the help desk can log, schedule, change or cancel trips.';
	const NOT_YOURS  = 'You can only start or finish a trip where you are the driver.';

	public function id(): string {
		return 'transport';
	}

	public function schema() {
		return 'CREATE TABLE ' . Azl_Db::t( 'trips' ) . " (
  id char(36) NOT NULL,
  tr_no int(11) unsigned NOT NULL,
  vehicle_key varchar(20) NOT NULL,
  vehicle varchar(80) NOT NULL,
  driver varchar(120) NOT NULL DEFAULT '',
  dest varchar(160) NOT NULL,
  purpose varchar(160) NOT NULL DEFAULT '',
  passengers varchar(160) NOT NULL DEFAULT '',
  status varchar(12) NOT NULL DEFAULT 'scheduled',
  sched_at bigint(20) DEFAULT NULL,
  dep_at bigint(20) DEFAULT NULL,
  arr_at bigint(20) DEFAULT NULL,
  created_by char(36) DEFAULT NULL,
  op_id char(36) NOT NULL,
  created_at bigint(20) NOT NULL,
  updated_at bigint(20) NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY tr_no (tr_no),
  UNIQUE KEY op_id (op_id),
  KEY status_sched (status,sched_at),
  KEY updated_at (updated_at)
) " . Azl_Schema::table_options() . ';';
	}

	public function sequences(): array {
		return array( 'tr' );
	}

	public function catalogLists(): array {
		return array(
			'vehicles' => array(
				'label'    => array( 'vehicle', 'vehicles' ),
				'maxItems' => 30,
				'fields'   => array(),
				'seed'     => array( array( 'label' => 'Van 1' ), array( 'label' => 'Van 2' ), array( 'label' => 'Shuttle' ) ),
			),
		);
	}

	public function commands(): array {
		$prior = static function ( string $id ): array {
			$n = Azl_Db::val( 'SELECT tr_no FROM ' . Azl_Db::t( 'trips' ) . ' WHERE id = %s', array( $id ) );
			return null === $n ? array() : array( 'trNo' => (int) $n );
		};
		// Department staff (own access) may only depart and arrive their own trips; the rest is the desk's (ownRefusal).
		$desk = static function ( array $cmd, array $who ): bool {
			return 'staff' !== ( $who['kind'] ?? '' );
		};
		return array(
			'logTrip'      => array( 'ids' => array( 'tripId' ), 'validate' => array( $this, 'check_new' ), 'run' => array( $this, 'log' ), 'prior' => $prior, 'scope' => $desk ),
			'scheduleTrip' => array( 'ids' => array( 'tripId' ), 'validate' => array( $this, 'check_scheduled' ), 'run' => array( $this, 'schedule' ), 'prior' => $prior, 'scope' => $desk ),
			'editTrip'     => array( 'ids' => array( 'tripId' ), 'validate' => array( $this, 'check_edit' ), 'run' => array( $this, 'edit' ), 'scope' => $desk ),
			'departTrip'   => array( 'ids' => array( 'tripId' ), 'run' => array( $this, 'depart' ) ),
			'arriveTrip'   => array( 'ids' => array( 'tripId' ), 'run' => array( $this, 'arrive' ) ),
			'cancelTrip'   => array( 'ids' => array( 'tripId' ), 'run' => array( $this, 'cancel' ), 'scope' => $desk ),
		);
	}

	public function ownRefusal( string $type ): ?string {
		return self::DESK_ONLY;
	}

	/* ---------- validation: plain-language problems, before anything is written ---------- */

	/** The checked text fields, or the problem. */
	private static function fields( array $cmd ) {
		$f = array(
			'driver'     => Azl_Commands::line( $cmd['driver'] ?? '' ),
			'dest'       => Azl_Commands::line( $cmd['dest'] ?? '' ),
			'purpose'    => Azl_Commands::line( $cmd['purpose'] ?? '' ),
			'passengers' => Azl_Commands::line( $cmd['passengers'] ?? '' ),
		);
		if ( '' === $f['dest'] ) {
			return 'Destination required';
		}
		foreach ( array( 'driver' => self::DRIVER_MAX, 'dest' => self::TEXT_MAX, 'purpose' => self::TEXT_MAX, 'passengers' => self::TEXT_MAX ) as $k => $max ) {
			if ( mb_strlen( $f[ $k ] ) > $max ) {
				return "Keep the $k under $max characters.";
			}
		}
		return $f;
	}

	private static function vehicle_of( array $cmd ): ?array {
		return Azl_Catalog::active( Azl_Catalog::get(), 'vehicles', $cmd['vehicle'] ?? null );
	}

	public function check_new( array $cmd ): ?string {
		$f = self::fields( $cmd );
		if ( is_string( $f ) ) {
			return $f;
		}
		return null === self::vehicle_of( $cmd ) ? 'Choose a vehicle.' : null;
	}

	/** The scheduled moment (epoch ms) for a local date "2026-10-31" and time "14:00", or null when it is not a real one. */
	public static function sched_at( $date, $time ): ?int {
		if ( ! is_string( $date ) || ! is_string( $time ) ) {
			return null;
		}
		$d = DateTimeImmutable::createFromFormat( '!Y-m-d H:i', "$date $time", new DateTimeZone( self::TZ ) );
		if ( false === $d || "$date $time" !== $d->format( 'Y-m-d H:i' ) ) {
			return null;
		}
		return $d->getTimestamp() * 1000;
	}

	private static function sched_problem( array $cmd ): ?string {
		$at = self::sched_at( $cmd['date'] ?? null, $cmd['time'] ?? null );
		if ( null === $at ) {
			return 'Choose a date and a time.';
		}
		// Generous on purpose: a command saved offline is applied later, so only an obviously wrong date is refused.
		if ( $at < Azl_Db::now() - 86400000 || $at > Azl_Db::now() + 400 * 86400000 ) {
			return 'Choose a date from yesterday to a year ahead.';
		}
		return null;
	}

	public function check_scheduled( array $cmd ): ?string {
		return $this->check_new( $cmd ) ?? self::sched_problem( $cmd );
	}

	public function check_edit( array $cmd ): ?string {
		$f = self::fields( $cmd );
		if ( is_string( $f ) ) {
			return $f;
		}
		return ! is_string( $cmd['vehicle'] ?? null ) ? 'Choose a vehicle.' : ( isset( $cmd['date'] ) || isset( $cmd['time'] ) ? self::sched_problem( $cmd ) : null );
	}

	/* ---------- who may do what ---------- */

	/** The reason this actor may not depart or arrive this trip, or null. (Desk-only commands: Azl_Access, ownRefusal.) */
	private static function refused( Azl_Commands $ctx, array $trip ): ?string {
		if ( 'staff' !== ( $ctx->who()['kind'] ?? '' ) ) {
			return null; // help desk, supervisor, manager, owner: full access
		}
		$me = null === $ctx->actor() ? '' : (string) Azl_Db::val( 'SELECT name FROM ' . Azl_Db::t( 'staff' ) . ' WHERE id = %s', array( $ctx->actor() ) );
		return '' !== $me && 0 === strcasecmp( trim( $trip['driver'] ), $me ) ? null : self::NOT_YOURS;
	}

	private static function locked( string $id ): ?array {
		return Azl_Db::row( 'SELECT * FROM ' . Azl_Db::t( 'trips' ) . ' WHERE id = %s' . Azl_Db::lock(), array( $id ) );
	}

	/* ---------- commands ---------- */

	private function create( array $cmd, Azl_Commands $ctx, string $status, ?int $sched, string $what ): array {
		if ( null !== self::locked( $cmd['tripId'] ) ) {
			return Azl_Commands::fail( 'This trip already exists.' );
		}
		if ( ! $ctx->claim( 'trip', $cmd['tripId'], $what ) ) {
			return $ctx->replay( $cmd );
		}
		$f   = self::fields( $cmd );
		$v   = self::vehicle_of( $cmd );
		$n   = Azl_Db::bump( 'tr' );
		$row = array(
			'id'          => $cmd['tripId'],
			'tr_no'       => $n,
			'vehicle_key' => $v['key'],
			'vehicle'     => $v['label'],
			'driver'      => $f['driver'],
			'dest'        => $f['dest'],
			'purpose'     => $f['purpose'],
			'passengers'  => $f['passengers'],
			'status'      => $status,
			'op_id'       => $ctx->op(),
			'created_at'  => $ctx->now(),
			'updated_at'  => $ctx->now(),
		);
		if ( null !== $sched ) {
			$row['sched_at'] = $sched;
		}
		if ( 'en_route' === $status ) {
			$row['dep_at'] = $ctx->now();
		}
		if ( null !== $ctx->actor() ) {
			$row['created_by'] = $ctx->actor();
		}
		Azl_Db::insert( 'trips', $row );
		return Azl_Commands::ok( array( 'trNo' => $n ) );
	}

	public function log( array $cmd, Azl_Commands $ctx ): array {
		return $this->create( $cmd, $ctx, 'en_route', null, 'Logged' );
	}

	public function schedule( array $cmd, Azl_Commands $ctx ): array {
		return $this->create( $cmd, $ctx, 'scheduled', self::sched_at( $cmd['date'], $cmd['time'] ), 'Scheduled' );
	}

	/** Moves a trip from one status to another, stamping a time column. */
	private function step( array $cmd, Azl_Commands $ctx, string $from, string $to, string $col, string $what, array $wrong ): array {
		$trip = self::locked( $cmd['tripId'] );
		if ( null === $trip ) {
			return Azl_Commands::fail( 'Unknown trip' );
		}
		$refused = self::refused( $ctx, $trip );
		if ( null !== $refused ) {
			return Azl_Commands::fail( $refused );
		}
		if ( $from !== $trip['status'] ) {
			return Azl_Commands::fail( $wrong[ $trip['status'] ] );
		}
		if ( ! $ctx->claim( 'trip', $trip['id'], $what ) ) {
			return $ctx->replay( $cmd );
		}
		Azl_Db::update( 'trips', array( 'status' => $to, $col => $ctx->now(), 'updated_at' => $ctx->now() ), array( 'id' => $trip['id'] ) );
		return Azl_Commands::ok();
	}

	public function depart( array $cmd, Azl_Commands $ctx ): array {
		return $this->step(
			$cmd,
			$ctx,
			'scheduled',
			'en_route',
			'dep_at',
			'Departed',
			array( 'en_route' => 'This trip has already left.', 'arrived' => 'This trip has already arrived.', 'cancelled' => 'This trip was cancelled.' )
		);
	}

	public function arrive( array $cmd, Azl_Commands $ctx ): array {
		return $this->step(
			$cmd,
			$ctx,
			'en_route',
			'arrived',
			'arr_at',
			'Arrived',
			array( 'scheduled' => 'This trip has not left yet. Depart it first.', 'arrived' => 'This trip has already arrived.', 'cancelled' => 'This trip was cancelled.' )
		);
	}

	public function cancel( array $cmd, Azl_Commands $ctx ): array {
		$trip = self::locked( $cmd['tripId'] );
		if ( null === $trip ) {
			return Azl_Commands::fail( 'Unknown trip' );
		}
		if ( 'scheduled' !== $trip['status'] ) {
			return Azl_Commands::fail( 'Only a scheduled trip can be cancelled.' );
		}
		if ( ! $ctx->claim( 'trip', $trip['id'], 'Cancelled' ) ) {
			return $ctx->replay( $cmd );
		}
		Azl_Db::update( 'trips', array( 'status' => 'cancelled', 'updated_at' => $ctx->now() ), array( 'id' => $trip['id'] ) );
		return Azl_Commands::ok();
	}

	public function edit( array $cmd, Azl_Commands $ctx ): array {
		$trip = self::locked( $cmd['tripId'] );
		if ( null === $trip ) {
			return Azl_Commands::fail( 'Unknown trip' );
		}
		if ( ! in_array( $trip['status'], array( 'scheduled', 'en_route' ), true ) ) {
			return Azl_Commands::fail( 'A trip that has arrived or was cancelled cannot be changed.' );
		}
		// The vehicle may stay as it is even when it has since been removed from the list.
		$v = $cmd['vehicle'] === $trip['vehicle_key'] ? array( 'key' => $trip['vehicle_key'], 'label' => $trip['vehicle'] ) : self::vehicle_of( $cmd );
		if ( null === $v ) {
			return Azl_Commands::fail( 'Choose a vehicle.' );
		}
		$f     = self::fields( $cmd );
		$sched = $trip['sched_at'];
		if ( 'scheduled' === $trip['status'] ) {
			$at = self::sched_at( $cmd['date'] ?? null, $cmd['time'] ?? null );
			if ( null === $at ) {
				return Azl_Commands::fail( 'Choose a date and a time.' );
			}
			$sched = (string) $at;
		}
		$new = array( 'vehicle_key' => $v['key'], 'vehicle' => $v['label'], 'driver' => $f['driver'], 'dest' => $f['dest'], 'purpose' => $f['purpose'], 'passengers' => $f['passengers'] );
		if ( null !== $sched && (string) $sched !== (string) $trip['sched_at'] ) {
			$new['sched_at'] = (int) $sched;
		}
		$changed = array_filter(
			$new,
			static function ( $val, $k ) use ( $trip ) {
				return (string) $val !== (string) $trip[ $k ];
			},
			ARRAY_FILTER_USE_BOTH
		);
		if ( array() === $changed ) {
			return Azl_Commands::fail( 'Nothing was changed.' );
		}
		if ( ! $ctx->claim( 'trip', $trip['id'], 'Edited' ) ) {
			return $ctx->replay( $cmd );
		}
		Azl_Db::update( 'trips', $changed + array( 'updated_at' => $ctx->now() ), array( 'id' => $trip['id'] ) );
		return Azl_Commands::ok();
	}

	/* ---------- snapshot ---------- */

	public function snapshot( array $who ): array {
		$t    = Azl_Db::t( 'trips' );
		$rows = Azl_Db::rows(
			"SELECT * FROM $t WHERE status IN ('scheduled','en_route') OR updated_at > %d ORDER BY created_at DESC, id DESC LIMIT %d",
			array( Azl_Db::now() - self::DONE_DAYS * 86400000, self::CAP )
		);
		$trips = array();
		foreach ( $rows as $r ) {
			$trip = array(
				'id'         => $r['id'],
				'no'         => 'TR-' . Azl_Rules::pad( (int) $r['tr_no'] ),
				'vehicleKey' => $r['vehicle_key'],
				'vehicle'    => $r['vehicle'],
				'driver'     => $r['driver'],
				'dest'       => $r['dest'],
				'purpose'    => $r['purpose'],
				'passengers' => $r['passengers'],
				'status'     => $r['status'],
				'createdAt'  => (int) $r['created_at'],
			);
			foreach ( array( 'sched_at' => 'schedAt', 'dep_at' => 'depAt', 'arr_at' => 'arrAt' ) as $col => $key ) {
				if ( null !== $r[ $col ] ) {
					$trip[ $key ] = (int) $r[ $col ];
				}
			}
			$trips[] = $trip;
		}
		$vehicles = array();
		foreach ( Azl_Catalog::get()['vehicles'] as $v ) {
			$vehicles[] = array( 'key' => $v['key'], 'label' => $v['label'], 'active' => true === $v['active'] );
		}
		// Transport has no sidebar badge (the prototype has none).
		return array( 'trips' => $trips, 'vehicles' => $vehicles );
	}
}

Azl_Modules::register( new Azl_Module_Transport() );
