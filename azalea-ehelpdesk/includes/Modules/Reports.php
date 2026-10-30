<?php
/**
 * Reports (sidebar id reports): the client prototype's six report tiles (docs/MODULES-SPEC.md A.12), made real with
 * read-only queries over the other modules' tables. No tables of its own, no commands.
 *
 *   GET /azl-ehd/v1/reports/<id>?from=YYYY-MM-DD&to=YYYY-MM-DD[&dept=&type=&priority=&status=&contact=&code=][&format=csv]
 *   <id>: overview (the tile headlines), response, kpi, turnaround, workorders, inquiries, crisis.
 *
 * Rules:
 * - Who: the role matrix (Azl_Access, B.3): owner and manager full, supervisor read, everyone else refused (403).
 *   On a shared phone the person signed in with a PIN decides, as for the snapshot.
 * - Days are the hotel's calendar days (Asia/Manila), never UTC: from and to are local dates, the range is
 *   [midnight of from, midnight after to). Per-day and per-hour buckets add the zone's offset to the epoch ms in SQL.
 *   Manila keeps UTC+8 all year (no daylight saving), so one offset is exact for every row.
 * - At most 366 days. The previous period (KPI Dashboard) is the same number of days right before.
 * - Operation, never people (brief 3.3 and 7): figures are by department, request type, cleaning type, code or day.
 *   No staff name or id, no guest or involved-person name, no free text is ever selected. The Room Turnaround is by
 *   cleaning type, not by room attendant as the prototype's tile says.
 * - Every value goes through a placeholder; column and table names are constants.
 * - format=csv: the report's table as CSV, UTF-8 with a BOM (Excel shows accents), cells that a spreadsheet would read
 *   as a formula (= + - @, tab, carriage return) start with an apostrophe. serve_csv() writes it raw.
 *
 * @package azl-ehd
 */

defined( 'ABSPATH' ) || exit;

final class Azl_Module_Reports extends Azl_Module {

	const IDS       = array( 'overview', 'response', 'kpi', 'turnaround', 'workorders', 'inquiries', 'crisis' );
	const TITLES    = array(
		'overview'   => 'Reports',
		'response'   => 'Response Time',
		'kpi'        => 'KPI Dashboard',
		'turnaround' => 'Room Turnaround',
		'workorders' => 'WO Summary',
		'inquiries'  => 'Inquiry Volume',
		'crisis'     => 'Crisis Log',
	);
	const TZ        = 'Asia/Manila';
	const DAY_MS    = 86400000;
	const MAX_DAYS  = 366;
	const RELAY_MS  = 120000;   // relay (creation to acknowledgement) within 2 minutes, as on the desk
	const MAX_ROWS  = 500;      // list tables (work orders, crisis cases); the totals always count every row
	const INVALID   = 'azl_invalid';
	const PRIORITY  = array( 'low', 'medium', 'high', 'urgent' );
	const WO_STATUS = array( 'scheduled', 'reported', 'assessed', 'in_progress', 'on_hold', 'done' );
	const CONTACTS  = array( 'in_house' => 'In-house guest', 'external' => 'External', 'checked_out' => 'Checked-out guest' );
	const CR_STATUS = array( 'active' => 'Active', 'monitoring' => 'Monitoring', 'resolved' => 'Closed' );

	public function id(): string {
		return 'reports';
	}

	/** The routes and the raw CSV writer. Called once when the file loads. */
	public static function hooks(): void {
		add_action( 'rest_api_init', array( self::class, 'register_routes' ) );
		add_filter( 'rest_pre_serve_request', array( self::class, 'serve_csv' ), 10, 4 );
	}

	public static function register_routes(): void {
		register_rest_route(
			Azl_Rest::NS,
			'/reports/(?P<report>' . implode( '|', self::IDS ) . ')',
			array(
				'methods'             => 'GET',
				'callback'            => array( self::class, 'get' ),
				'permission_callback' => array( self::class, 'can_read' ),
			)
		);
	}

	/* ---------- who ---------- */

	/** The actor's kind (Azl_Access::who), with the PIN person on a shared phone. Kind none when the token ended. */
	public static function who( $request ): array {
		$user = (int) get_current_user_id();
		if ( ! user_can( $user, Azl_Caps::USE_DESK ) ) {
			return array( 'kind' => 'none', 'dept' => null );
		}
		$actor = Azl_Staff::actor_for( $user, $request->get_header( Azl_Rest::ACTOR_HEADER ) );
		return $actor['ok'] ? Azl_Access::who( $user, $actor['staff'] ) : array( 'kind' => 'none', 'dept' => null );
	}

	/** Owner and manager (full) and supervisor (read) may open reports; nobody else. */
	public static function can_read( $request ): bool {
		return 'none' !== Azl_Access::level( 'reports', self::who( $request ) );
	}

	/* ---------- the route ---------- */

	public static function get( $request ) {
		try {
			$id = (string) $request->get_param( 'report' );
			if ( ! in_array( $id, self::IDS, true ) ) {
				return self::reply( array( 'ok' => false, 'code' => self::INVALID, 'error' => 'Unknown report.' ), 404 );
			}
			$q = self::params( $request, $id );
			if ( isset( $q['error'] ) ) {
				return self::reply( array( 'ok' => false, 'code' => self::INVALID, 'error' => $q['error'] ), 400 );
			}
			$out = self::build( $id, $q );
			if ( 'csv' === $q['format'] ) {
				if ( 'overview' === $id ) {
					return self::reply( array( 'ok' => false, 'code' => self::INVALID, 'error' => 'Open a report to export it.' ), 400 );
				}
				return self::reply(
					self::csv( $out['table'] ),
					200,
					array(
						'Content-Type'           => 'text/csv; charset=utf-8',
						'Content-Disposition'    => 'attachment; filename="' . self::filename( $id, $q ) . '"',
						'X-Content-Type-Options' => 'nosniff',
					)
				);
			}
			return self::reply( $out );
		} catch ( Throwable $e ) {
			error_log( 'azl-ehd reports error: ' . $e->getMessage() );
			return self::reply( array( 'ok' => false, 'error' => Azl_Commands::ERROR ), 500 );
		}
	}

	/** Writes a CSV report as it is (WordPress would JSON-encode the string). Headers are already sent by then. */
	public static function serve_csv( $served, $result, $request, $server ) {
		if ( $served || ! ( $result instanceof WP_REST_Response ) || ! is_string( $result->get_data() ) ) {
			return $served;
		}
		$type = (string) ( $result->get_headers()['Content-Type'] ?? '' );
		if ( 0 !== strpos( $type, 'text/csv' ) ) {
			return $served;
		}
		echo $result->get_data(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- a CSV download, escaped by csv()
		return true;
	}

	private static function reply( $data, int $status = 200, array $headers = array() ): WP_REST_Response {
		$r = new WP_REST_Response( $data, $status );
		$r->header( 'Cache-Control', 'no-store, max-age=0' );
		$r->header( 'Pragma', 'no-cache' );
		foreach ( $headers as $k => $v ) {
			$r->header( $k, $v );
		}
		return $r;
	}

	/* ---------- parameters ---------- */

	/**
	 * The checked parameters, or ['error' => plain message]. Dates default to the last 7 days ending today.
	 *
	 * @return array{from: string, to: string, start: int, end: int, days: int, format: string, f: array}|array{error: string}
	 */
	public static function params( $request, string $id ): array {
		$today = Azl_Module_WorkOrders::ms_date( Azl_Db::now() );
		$from  = $request->get_param( 'from' );
		$to    = $request->get_param( 'to' );
		$to    = null === $to || '' === $to ? $today : $to;
		$from  = null === $from || '' === $from ? self::add_days( (string) $to, -6 ) : $from;
		$start = Azl_Module_WorkOrders::date_ms( $from );
		$last  = Azl_Module_WorkOrders::date_ms( $to );
		if ( null === $start || null === $last ) {
			return array( 'error' => 'Choose real dates (YYYY-MM-DD).' );
		}
		if ( $start > $last ) {
			return array( 'error' => 'The start date is after the end date.' );
		}
		$end  = (int) Azl_Module_WorkOrders::date_ms( self::add_days( $to, 1 ) );
		$days = (int) round( ( $end - $start ) / self::DAY_MS );
		if ( $days > self::MAX_DAYS ) {
			return array( 'error' => 'Choose at most ' . self::MAX_DAYS . ' days.' );
		}
		$format = $request->get_param( 'format' );
		$format = null === $format || '' === $format ? 'json' : $format;
		if ( ! in_array( $format, array( 'json', 'csv' ), true ) ) {
			return array( 'error' => 'Unknown format.' );
		}
		$f     = array();
		$check = array(
			'dept'     => static fn( $v ) => is_string( $v ) && 1 === preg_match( '/^[a-z0-9_]{1,20}\z/', $v ),
			'type'     => static fn( $v ) => is_string( $v ) && '' !== trim( $v ) && strlen( $v ) <= 120,
			'priority' => static fn( $v ) => in_array( $v, self::PRIORITY, true ),
			'status'   => static fn( $v ) => in_array( $v, 'crisis' === $id ? array_keys( self::CR_STATUS ) : self::WO_STATUS, true ),
			'contact'  => static fn( $v ) => is_string( $v ) && isset( self::CONTACTS[ $v ] ),
			'code'     => static fn( $v ) => is_string( $v ) && 1 === preg_match( '/^[a-z0-9_]{1,20}\z/', $v ),
		);
		foreach ( $check as $k => $ok ) {
			$v = $request->get_param( $k );
			if ( null === $v || '' === $v ) {
				continue;
			}
			if ( ! $ok( $v ) ) {
				return array( 'error' => 'That ' . ( 'type' === $k ? 'request type' : $k ) . ' filter is not valid.' );
			}
			$f[ $k ] = 'type' === $k ? sanitize_text_field( $v ) : $v;
		}
		return array( 'from' => $from, 'to' => $to, 'start' => $start, 'end' => $end, 'days' => $days, 'format' => $format, 'f' => $f );
	}

	private static function add_days( string $date, int $n ): string {
		$ms = Azl_Module_WorkOrders::date_ms( $date );
		return null === $ms ? $date : Azl_Module_WorkOrders::ms_date( $ms + $n * self::DAY_MS + 12 * 3600000 );
	}

	/* ---------- SQL pieces ---------- */

	/** The hotel zone's offset from UTC in ms (Manila: +8 h all year). */
	private static function offset(): int {
		return 1000 * ( new DateTimeZone( self::TZ ) )->getOffset( new DateTimeImmutable( '@' . intdiv( Azl_Db::now(), 1000 ) ) );
	}

	/** Integer division of two non-negative integers, the same in MySQL and SQLite. */
	private static function idiv( string $expr, int $n ): string {
		return 'mysql' === Azl_Db::$dialect ? "FLOOR(($expr) / $n)" : "(($expr) / $n)";
	}

	/** The hotel-local day number (days since 1970-01-01 local) of a ms column. */
	private static function day_sql( string $col ): string {
		return self::idiv( "$col + " . self::offset(), self::DAY_MS );
	}

	private static function day_date( int $n ): string {
		return gmdate( 'Y-m-d', $n * 86400 );
	}

	/** A rounded number; whole numbers as int, so 30 is 30 and not 30.0 in JSON and CSV. */
	private static function num( $v, int $dp = 0 ) {
		if ( null === $v ) {
			return null;
		}
		$x = round( (float) $v, $dp );
		return floor( $x ) === $x && abs( $x ) < PHP_INT_MAX ? (int) $x : $x;
	}

	private static function pct( $n, $d ): ?int {
		return (int) $d > 0 ? (int) round( 100 * (int) $n / (int) $d ) : null;
	}

	private static function min( $ms ) {
		return null === $ms ? null : self::num( (float) $ms / 60000, 1 );
	}

	private static function hours( $ms ) {
		return null === $ms ? null : self::num( (float) $ms / 3600000, 1 );
	}

	/** Labels of an editable list: key => label (inactive ones too: history keeps its words). */
	private static function labels( string $list ): array {
		$out = array();
		foreach ( Azl_Catalog::get()[ $list ] ?? array() as $x ) {
			$out[ $x['key'] ] = 'crisisCodes' === $list && ! empty( $x['code'] ) ? $x['code'] . ' ' . $x['label'] : $x['label'];
		}
		return $out;
	}

	private static function options( string $list ): array {
		$out = array();
		foreach ( self::labels( $list ) as $k => $l ) {
			$out[] = array( 'value' => (string) $k, 'label' => $l );
		}
		return $out;
	}

	private static function col( string $key, string $label, string $unit = '' ): array {
		return array( 'key' => $key, 'label' => $label, 'unit' => $unit );
	}

	private static function fig( string $key, string $label, $value, string $unit ): array {
		return array( 'key' => $key, 'label' => $label, 'value' => $value, 'unit' => $unit );
	}

	/* ---------- the reports ---------- */

	public static function build( string $id, array $q ): array {
		$body = 'overview' === $id ? self::overview( $q ) : self::$id( $q );
		return array(
			'ok'      => true,
			'report'  => $id,
			'title'   => self::TITLES[ $id ],
			'range'   => array( 'from' => $q['from'], 'to' => $q['to'], 'days' => $q['days'] ),
			'filters' => (object) $q['f'],
		) + $body;
	}

	/** The six tiles' headline numbers, for the same range. */
	private static function overview( array $q ): array {
		$q['f'] = array();
		$out    = array();
		foreach ( array_slice( self::IDS, 1 ) as $id ) {
			$out[ $id ] = self::$id( $q )['headline'];
		}
		return array( 'headlines' => $out );
	}

	/** Items logged in the range, with the request filters (department, request type). */
	private static function item_where( array $q, string $a = '' ): array {
		$p    = '' === $a ? '' : "$a.";
		$sql  = " WHERE {$p}created_at >= %d AND {$p}created_at < %d";
		$args = array( $q['start'], $q['end'] );
		if ( isset( $q['f']['dept'] ) ) {
			$sql   .= " AND {$p}dept = %s";
			$args[] = $q['f']['dept'];
		}
		if ( isset( $q['f']['type'] ) ) {
			$sql   .= " AND {$p}name = %s";
			$args[] = $q['f']['type'];
		}
		return array( $sql, $args );
	}

	/** The two clocks of the desk (brief 2.11): relay = creation to acknowledgement; work = acknowledgement to done minus hold. */
	private static function clock_cols(): string {
		$done = "status = 'done' AND ack_at IS NOT NULL AND done_at IS NOT NULL";
		$work = 'done_at - ack_at - held_ms';
		return 'COUNT(*) AS n,
			SUM(CASE WHEN ack_at IS NOT NULL THEN 1 ELSE 0 END) AS acked,
			SUM(CASE WHEN ack_at IS NOT NULL AND ack_at - created_at <= ' . self::RELAY_MS . ' THEN 1 ELSE 0 END) AS relay_ok,
			AVG(CASE WHEN ack_at IS NOT NULL THEN ack_at - created_at END) AS relay_avg,
			SUM(CASE WHEN ' . $done . ' THEN 1 ELSE 0 END) AS done,
			SUM(CASE WHEN ' . $done . ' AND ' . $work . ' <= sla_min * 60000 THEN 1 ELSE 0 END) AS done_ok,
			AVG(CASE WHEN ' . $done . ' THEN ' . $work . ' END) AS work_avg,
			AVG(sla_min) AS target';
	}

	private static function clock_row( array $r ): array {
		return array(
			'items'     => (int) $r['n'],
			'relayAvg'  => self::min( $r['relay_avg'] ),
			'relayPct'  => self::pct( $r['relay_ok'], $r['acked'] ),
			'workAvg'   => self::min( $r['work_avg'] ),
			'withinPct' => self::pct( $r['done_ok'], $r['done'] ),
			'done'      => (int) $r['done'],
			'target'    => self::num( $r['target'] ),
		);
	}

	private static function response( array $q ): array {
		$t                 = Azl_Db::t( 'items' );
		list( $w, $args )  = self::item_where( $q );
		$dl                = self::labels( 'departments' );
		$all               = self::clock_row( Azl_Db::row( 'SELECT ' . self::clock_cols() . " FROM $t$w", $args ) );
		$by_dept           = array();
		foreach ( Azl_Db::rows( 'SELECT dept, ' . self::clock_cols() . " FROM $t$w GROUP BY dept ORDER BY dept", $args ) as $r ) {
			$by_dept[] = array( 'dept' => $r['dept'], 'label' => $dl[ $r['dept'] ] ?? $r['dept'] ) + self::clock_row( $r );
		}
		$rows = array();
		foreach ( Azl_Db::rows( 'SELECT name, dept, ' . self::clock_cols() . " FROM $t$w GROUP BY name, dept ORDER BY n DESC, name", $args ) as $r ) {
			$rows[] = array( 'type' => $r['name'], 'dept' => $dl[ $r['dept'] ] ?? $r['dept'] ) + self::clock_row( $r );
		}
		$work = 'done_at - ack_at - held_ms';
		$done = "status = 'done' AND ack_at IS NOT NULL AND done_at IS NOT NULL";
		$d    = Azl_Db::row(
			'SELECT
				SUM(CASE WHEN ack_at IS NOT NULL AND ack_at - created_at <= 60000 THEN 1 ELSE 0 END) AS r1,
				SUM(CASE WHEN ack_at IS NOT NULL AND ack_at - created_at > 60000 AND ack_at - created_at <= 120000 THEN 1 ELSE 0 END) AS r2,
				SUM(CASE WHEN ack_at IS NOT NULL AND ack_at - created_at > 120000 AND ack_at - created_at <= 300000 THEN 1 ELSE 0 END) AS r3,
				SUM(CASE WHEN ack_at IS NOT NULL AND ack_at - created_at > 300000 AND ack_at - created_at <= 900000 THEN 1 ELSE 0 END) AS r4,
				SUM(CASE WHEN ack_at IS NOT NULL AND ack_at - created_at > 900000 THEN 1 ELSE 0 END) AS r5,
				SUM(CASE WHEN ' . $done . " AND $work <= sla_min * 30000 THEN 1 ELSE 0 END) AS w1,
				SUM(CASE WHEN $done AND $work > sla_min * 30000 AND $work <= sla_min * 60000 THEN 1 ELSE 0 END) AS w2,
				SUM(CASE WHEN $done AND $work > sla_min * 60000 AND $work <= sla_min * 120000 THEN 1 ELSE 0 END) AS w3,
				SUM(CASE WHEN $done AND $work > sla_min * 120000 THEN 1 ELSE 0 END) AS w4
			FROM $t$w",
			$args
		);
		$bucket = static function ( array $labels, string $p ) use ( $d ): array {
			$out = array();
			foreach ( $labels as $i => $l ) {
				$out[] = array( 'label' => $l, 'count' => (int) ( $d[ $p . ( $i + 1 ) ] ?? 0 ) );
			}
			return $out;
		};
		$types = array();
		foreach ( Azl_Db::rows( "SELECT DISTINCT name FROM $t WHERE created_at >= %d AND created_at < %d ORDER BY name LIMIT 200", array( $q['start'], $q['end'] ) ) as $r ) {
			$types[] = array( 'value' => $r['name'], 'label' => $r['name'] );
		}
		return array(
			'headline' => self::fig( 'withinPct', 'finished within target', $all['withinPct'], 'pct' ),
			'summary'  => array(
				self::fig( 'items', 'Items logged', $all['items'], 'count' ),
				self::fig( 'relayAvg', 'Average time to relay', $all['relayAvg'], 'min' ),
				self::fig( 'relayPct', 'Relayed within 2 minutes', $all['relayPct'], 'pct' ),
				self::fig( 'workAvg', 'Average time to complete', $all['workAvg'], 'min' ),
				self::fig( 'withinPct', 'Completed within target', $all['withinPct'], 'pct' ),
			),
			'options'  => array( 'dept' => self::options( 'departments' ), 'type' => $types ),
			'byDept'   => $by_dept,
			'relayDist' => $bucket( array( 'Under 1 min', '1 to 2 min', '2 to 5 min', '5 to 15 min', 'Over 15 min' ), 'r' ),
			'workDist'  => $bucket( array( 'Under half the target', 'Within target', 'Up to twice the target', 'Over twice the target' ), 'w' ),
			'empty'    => 0 === $all['items'],
			'table'    => array(
				'columns' => array( self::col( 'type', 'Request type' ), self::col( 'dept', 'Department' ), self::col( 'items', 'Items', 'count' ), self::col( 'relayAvg', 'Avg to relay', 'min' ), self::col( 'relayPct', 'Relayed within 2 min', 'pct' ), self::col( 'workAvg', 'Avg to complete', 'min' ), self::col( 'target', 'Target', 'min' ), self::col( 'withinPct', 'Within target', 'pct' ) ),
				'rows'    => $rows,
			),
		);
	}

	/** The key figures of one period (no filters). */
	private static function kpi_figures( int $start, int $end ): array {
		$range = array( $start, $end );
		$items = self::clock_row( Azl_Db::row( 'SELECT ' . self::clock_cols() . ' FROM ' . Azl_Db::t( 'items' ) . ' WHERE created_at >= %d AND created_at < %d', $range ) );
		$req   = (int) Azl_Db::val( 'SELECT COUNT(*) FROM ' . Azl_Db::t( 'requests' ) . ' WHERE created_at >= %d AND created_at < %d', $range );
		$inq   = Azl_Db::row( 'SELECT COUNT(*) AS n, SUM(CASE WHEN closed_at IS NOT NULL THEN 1 ELSE 0 END) AS closed, SUM(quick_close) AS quick FROM ' . Azl_Db::t( 'inquiries' ) . ' WHERE created_at >= %d AND created_at < %d', $range );
		$wo_in = (int) Azl_Db::val( 'SELECT COUNT(*) FROM ' . Azl_Db::t( 'work_orders' ) . ' WHERE created_at >= %d AND created_at < %d', $range );
		$wo_ok = (int) Azl_Db::val( 'SELECT COUNT(*) FROM ' . Azl_Db::t( 'work_orders' ) . " WHERE status = 'done' AND actual_end >= %d AND actual_end < %d", $range );
		$clean = (int) Azl_Db::val( 'SELECT COUNT(*) FROM ' . Azl_Db::t( 'clean_tasks' ) . " WHERE status = 'done' AND clock_out >= %d AND clock_out < %d", $range );
		$cr    = (int) Azl_Db::val( 'SELECT COUNT(*) FROM ' . Azl_Db::t( 'crisis_cases' ) . ' WHERE occurred_at >= %d AND occurred_at < %d', $range );
		return array(
			self::fig( 'requests', 'Tickets logged', $req, 'count' ),
			self::fig( 'items', 'Items logged', $items['items'], 'count' ),
			self::fig( 'relayPct', 'Relayed within 2 minutes', $items['relayPct'], 'pct' ),
			self::fig( 'withinPct', 'Completed within target', $items['withinPct'], 'pct' ),
			self::fig( 'relayAvg', 'Average time to relay', $items['relayAvg'], 'min' ),
			self::fig( 'workAvg', 'Average time to complete', $items['workAvg'], 'min' ),
			self::fig( 'inquiries', 'Inquiries', (int) $inq['n'], 'count' ),
			self::fig( 'quickPct', 'Inquiries closed within 6 minutes', self::pct( $inq['quick'], $inq['closed'] ), 'pct' ),
			self::fig( 'woReported', 'Work orders reported', $wo_in, 'count' ),
			self::fig( 'woDone', 'Work orders completed', $wo_ok, 'count' ),
			self::fig( 'cleaned', 'Rooms cleaned', $clean, 'count' ),
			self::fig( 'crisis', 'Crisis cases', $cr, 'count' ),
		);
	}

	private static function kpi( array $q ): array {
		$len  = $q['end'] - $q['start'];
		$now  = self::kpi_figures( $q['start'], $q['end'] );
		$prev = self::kpi_figures( $q['start'] - $len, $q['start'] );
		$rows = array();
		foreach ( $now as $i => $f ) {
			$p      = $prev[ $i ]['value'];
			$rows[] = array(
				'label'  => $f['label'],
				'value'  => $f['value'],
				'prev'   => $p,
				'change' => null === $f['value'] || null === $p ? null : self::num( $f['value'] - $p, 1 ),
				'unit'   => $f['unit'],
			);
		}
		// Items per hotel day, for the trend.
		$day   = self::day_sql( 'created_at' );
		$count = array();
		foreach ( Azl_Db::rows( "SELECT $day AS d, COUNT(*) AS n FROM " . Azl_Db::t( 'items' ) . " WHERE created_at >= %d AND created_at < %d GROUP BY $day", array( $q['start'], $q['end'] ) ) as $r ) {
			$count[ (int) $r['d'] ] = (int) $r['n'];
		}
		$first = intdiv( $q['start'] + self::offset(), self::DAY_MS );
		$trend = array();
		for ( $i = 0; $i < $q['days']; $i++ ) {
			$trend[] = array( 'date' => self::day_date( $first + $i ), 'count' => $count[ $first + $i ] ?? 0 );
		}
		$empty = true;
		foreach ( $now as $f ) {
			$empty = $empty && ( 'count' !== $f['unit'] || 0 === $f['value'] );
		}
		return array(
			'headline' => array( 'label' => 'items logged' ) + $now[1],
			'summary'  => $now,
			'previous' => array( 'from' => self::add_days( $q['from'], -$q['days'] ), 'to' => self::add_days( $q['from'], -1 ) ),
			'trend'    => $trend,
			'options'  => (object) array(),
			'empty'    => $empty,
			'table'    => array(
				'columns' => array( self::col( 'label', 'Figure' ), self::col( 'value', 'This period' ), self::col( 'prev', 'Previous period' ), self::col( 'change', 'Change' ), self::col( 'unit', 'Unit' ) ),
				'rows'    => $rows,
			),
		);
	}

	private static function turnaround( array $q ): array {
		$c     = Azl_Db::t( 'clean_tasks' );
		$i     = Azl_Db::t( 'items' );
		$r     = Azl_Db::t( 'requests' );
		$where = "c.status = 'done' AND c.clock_in IS NOT NULL AND c.clock_out >= %d AND c.clock_out < %d";
		$args  = array( $q['start'], $q['end'] );
		if ( isset( $q['f']['type'] ) ) {
			$where .= ' AND c.type = %s';
			$args[] = $q['f']['type'];
		}
		// The checkout moment: the task's own, else the room's last checkout or inspection item done in the 24 hours
		// before the clean ended (the rule of Azl_Commands::close_item that readies the room).
		$inner = "SELECT c.type AS type, c.clock_out - c.clock_in AS clean_ms,
				c.clock_out - COALESCE(c.checkout_at, (SELECT MAX(i.done_at) FROM $i i JOIN $r r ON r.id = i.request_id
					WHERE r.room = c.room AND i.status = 'done' AND (i.name LIKE '%%checkout%%' OR i.name LIKE '%%inspection%%')
					AND i.done_at <= c.clock_out AND i.done_at >= c.clock_out - " . self::DAY_MS . ')) AS turn_ms
			FROM ' . $c . " c WHERE $where";
		$cols  = 'COUNT(*) AS n, AVG(clean_ms) AS clean_avg, COUNT(turn_ms) AS turned, AVG(turn_ms) AS turn_avg,
			SUM(CASE WHEN turn_ms <= 3600000 THEN 1 ELSE 0 END) AS t1,
			SUM(CASE WHEN turn_ms > 3600000 AND turn_ms <= 7200000 THEN 1 ELSE 0 END) AS t2,
			SUM(CASE WHEN turn_ms > 7200000 AND turn_ms <= 14400000 THEN 1 ELSE 0 END) AS t3,
			SUM(CASE WHEN turn_ms > 14400000 THEN 1 ELSE 0 END) AS t4,
			SUM(CASE WHEN clean_ms <= 1200000 THEN 1 ELSE 0 END) AS c1,
			SUM(CASE WHEN clean_ms > 1200000 AND clean_ms <= 2400000 THEN 1 ELSE 0 END) AS c2,
			SUM(CASE WHEN clean_ms > 2400000 AND clean_ms <= 3600000 THEN 1 ELSE 0 END) AS c3,
			SUM(CASE WHEN clean_ms > 3600000 THEN 1 ELSE 0 END) AS c4';
		$all   = Azl_Db::row( "SELECT $cols FROM ($inner) x", $args );
		$tl    = self::labels( 'cleaningTypes' );
		$rows  = array();
		foreach ( Azl_Db::rows( "SELECT type, $cols FROM ($inner) x GROUP BY type ORDER BY n DESC, type", $args ) as $x ) {
			$rows[] = array(
				'type'      => $tl[ $x['type'] ] ?? $x['type'],
				'rooms'     => (int) $x['n'],
				'cleanAvg'  => self::min( $x['clean_avg'] ),
				'turned'    => (int) $x['turned'],
				'turnAvg'   => self::min( $x['turn_avg'] ),
			);
		}
		$dist = static function ( array $labels, string $p ) use ( $all ): array {
			$out = array();
			foreach ( $labels as $k => $l ) {
				$out[] = array( 'label' => $l, 'count' => (int) ( $all[ $p . ( $k + 1 ) ] ?? 0 ) );
			}
			return $out;
		};
		$turn = self::min( $all['turn_avg'] );
		return array(
			'headline'  => self::fig( 'turnAvg', 'checkout to clean room', $turn, 'min' ),
			'summary'   => array(
				self::fig( 'rooms', 'Rooms cleaned', (int) $all['n'], 'count' ),
				self::fig( 'cleanAvg', 'Average cleaning time', self::min( $all['clean_avg'] ), 'min' ),
				self::fig( 'turned', 'Checkouts matched', (int) $all['turned'], 'count' ),
				self::fig( 'turnAvg', 'Average checkout to clean room', $turn, 'min' ),
			),
			'options'   => array( 'type' => self::options( 'cleaningTypes' ) ),
			'turnDist'  => $dist( array( 'Within 1 h', '1 to 2 h', '2 to 4 h', 'Over 4 h' ), 't' ),
			'cleanDist' => $dist( array( 'Within 20 min', '20 to 40 min', '40 to 60 min', 'Over 60 min' ), 'c' ),
			'empty'     => 0 === (int) $all['n'],
			'table'     => array(
				'columns' => array( self::col( 'type', 'Cleaning type' ), self::col( 'rooms', 'Rooms cleaned', 'count' ), self::col( 'cleanAvg', 'Avg cleaning', 'min' ), self::col( 'turned', 'With a checkout time', 'count' ), self::col( 'turnAvg', 'Avg checkout to clean', 'min' ) ),
				'rows'    => $rows,
			),
		);
	}

	private static function workorders( array $q ): array {
		$t    = Azl_Db::t( 'work_orders' );
		$pri  = "CASE WHEN priority = 'normal' THEN 'medium' ELSE priority END";
		$w    = ' WHERE created_at >= %d AND created_at < %d';
		$args = array( $q['start'], $q['end'] );
		if ( isset( $q['f']['dept'] ) ) {
			$w     .= ' AND dept = %s';
			$args[] = $q['f']['dept'];
		}
		if ( isset( $q['f']['priority'] ) ) {
			$w     .= " AND $pri = %s";
			$args[] = $q['f']['priority'];
		}
		if ( isset( $q['f']['status'] ) ) {
			$w     .= ' AND status = %s';
			$args[] = $q['f']['status'];
		}
		// Overdue: open past its deadline day (the target end, moved by an extension, else the requested date), today
		// in hotel time. The same rule as the Work Orders screen.
		$today   = (int) Azl_Module_WorkOrders::date_ms( Azl_Module_WorkOrders::ms_date( Azl_Db::now() ) );
		$overdue = "status NOT IN ('done', 'scheduled') AND COALESCE(target_end, requested_date) IS NOT NULL AND COALESCE(target_end, requested_date) < $today";
		$done    = "status = 'done' AND actual_end IS NOT NULL";
		$cols    = "COUNT(*) AS n, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
			SUM(CASE WHEN $overdue THEN 1 ELSE 0 END) AS overdue,
			AVG(CASE WHEN $done THEN actual_end - created_at END) AS complete_avg,
			SUM(est_cost) AS est, SUM(CASE WHEN status = 'done' THEN actual_cost END) AS actual,
			SUM(CASE WHEN status = 'done' THEN est_cost END) AS est_done";
		$all     = Azl_Db::row( "SELECT $cols FROM $t$w", $args );
		$dl      = self::labels( 'departments' );
		$count   = static function ( string $expr ) use ( $t, $w, $args ): array {
			$out = array();
			foreach ( Azl_Db::rows( "SELECT $expr AS k, COUNT(*) AS n FROM $t$w GROUP BY $expr", $args ) as $r ) {
				$out[ $r['k'] ] = (int) $r['n'];
			}
			return $out;
		};
		$st       = $count( 'status' );
		$pr       = $count( $pri );
		$by_dept  = array();
		foreach ( Azl_Db::rows( "SELECT dept, $cols FROM $t$w GROUP BY dept ORDER BY n DESC, dept", $args ) as $r ) {
			$by_dept[] = array(
				'label'       => $dl[ $r['dept'] ] ?? $r['dept'],
				'count'       => (int) $r['n'],
				'done'        => (int) $r['done'],
				'overdue'     => (int) $r['overdue'],
				'completeAvg' => self::hours( $r['complete_avg'] ),
				'est'         => self::num( $r['est'], 2 ),
				'actual'      => self::num( $r['actual'], 2 ),
			);
		}
		$rows = array();
		foreach ( Azl_Db::rows( "SELECT wo_no, area, dept, $pri AS pri, status, created_at, actual_end, est_cost, actual_cost, ($overdue) AS late FROM $t$w ORDER BY created_at DESC, wo_no DESC LIMIT " . self::MAX_ROWS, $args ) as $r ) {
			$rows[] = array(
				'no'       => sprintf( 'WO-%04d', (int) $r['wo_no'] ),
				'area'     => $r['area'],
				'dept'     => $dl[ $r['dept'] ] ?? $r['dept'],
				'priority' => ucfirst( (string) $r['pri'] ),
				'status'   => ucfirst( str_replace( '_', ' ', (string) $r['status'] ) ),
				'reported' => Azl_Module_WorkOrders::ms_date( (int) $r['created_at'] ),
				'done'     => null === $r['actual_end'] ? null : Azl_Module_WorkOrders::ms_date( (int) $r['actual_end'] ),
				'hours'    => null === $r['actual_end'] ? null : self::hours( (int) $r['actual_end'] - (int) $r['created_at'] ),
				'est'      => self::num( $r['est_cost'], 2 ),
				'actual'   => self::num( $r['actual_cost'], 2 ),
				'overdue'  => '1' === (string) $r['late'] ? 'Yes' : 'No',
			);
		}
		$status = array();
		foreach ( self::WO_STATUS as $s ) {
			$status[] = array( 'label' => ucfirst( str_replace( '_', ' ', $s ) ), 'count' => $st[ $s ] ?? 0 );
		}
		$prio = array();
		foreach ( self::PRIORITY as $p ) {
			$prio[] = array( 'label' => ucfirst( $p ), 'count' => $pr[ $p ] ?? 0 );
		}
		$n    = (int) $all['n'];
		$open = $n - (int) $all['done'];
		return array(
			'headline' => self::fig( 'overdue', 'overdue', (int) $all['overdue'], 'count' ),
			'summary'  => array(
				self::fig( 'count', 'Work orders reported', $n, 'count' ),
				self::fig( 'open', 'Still open', $open, 'count' ),
				self::fig( 'overdue', 'Overdue', (int) $all['overdue'], 'count' ),
				self::fig( 'completeAvg', 'Average time to complete', self::hours( $all['complete_avg'] ), 'h' ),
				self::fig( 'est', 'Estimated cost', self::num( $all['est'], 2 ), 'php' ),
				self::fig( 'actual', 'Actual cost (completed)', self::num( $all['actual'], 2 ), 'php' ),
				self::fig( 'estDone', 'Estimate of the completed', self::num( $all['est_done'], 2 ), 'php' ),
			),
			'options'  => array( 'dept' => self::options( 'departments' ), 'priority' => array_map( static fn( $p ) => array( 'value' => $p, 'label' => ucfirst( $p ) ), self::PRIORITY ), 'status' => array_map( static fn( $s ) => array( 'value' => $s, 'label' => ucfirst( str_replace( '_', ' ', $s ) ) ), self::WO_STATUS ) ),
			'byStatus' => $status,
			'byPriority' => $prio,
			'byDept'   => $by_dept,
			'capped'   => $n > self::MAX_ROWS,
			'empty'    => 0 === $n,
			'table'    => array(
				'columns' => array( self::col( 'no', 'WO' ), self::col( 'area', 'Area' ), self::col( 'dept', 'Department' ), self::col( 'priority', 'Priority' ), self::col( 'status', 'Status' ), self::col( 'reported', 'Reported', 'date' ), self::col( 'done', 'Completed', 'date' ), self::col( 'hours', 'Time to complete', 'h' ), self::col( 'est', 'Estimated cost', 'php' ), self::col( 'actual', 'Actual cost', 'php' ), self::col( 'overdue', 'Overdue' ) ),
				'rows'    => $rows,
			),
		);
	}

	private static function inquiries( array $q ): array {
		$t    = Azl_Db::t( 'inquiries' );
		$w    = ' WHERE created_at >= %d AND created_at < %d';
		$args = array( $q['start'], $q['end'] );
		if ( isset( $q['f']['contact'] ) ) {
			$w     .= ' AND contact_type = %s';
			$args[] = $q['f']['contact'];
		}
		$all  = Azl_Db::row( "SELECT COUNT(*) AS n, SUM(CASE WHEN closed_at IS NOT NULL THEN 1 ELSE 0 END) AS closed, SUM(quick_close) AS quick, AVG(CASE WHEN closed_at IS NOT NULL THEN closed_at - created_at END) AS close_avg FROM $t$w", $args );
		$day  = self::day_sql( 'created_at' );
		$hour = self::idiv( '(created_at + ' . self::offset() . ') % ' . self::DAY_MS, 3600000 );
		$days = array();
		foreach ( Azl_Db::rows( "SELECT $day AS d, contact_type AS c, COUNT(*) AS n, SUM(CASE WHEN closed_at IS NOT NULL THEN 1 ELSE 0 END) AS closed, SUM(quick_close) AS quick FROM $t$w GROUP BY $day, contact_type", $args ) as $r ) {
			$d                      = (int) $r['d'];
			$days[ $d ]             = $days[ $d ] ?? array( 'n' => 0, 'closed' => 0, 'quick' => 0, 'in_house' => 0, 'external' => 0, 'checked_out' => 0 );
			$days[ $d ]['n']       += (int) $r['n'];
			$days[ $d ]['closed']  += (int) $r['closed'];
			$days[ $d ]['quick']   += (int) $r['quick'];
			if ( isset( self::CONTACTS[ $r['c'] ] ) ) {
				$days[ $d ][ $r['c'] ] += (int) $r['n'];
			}
		}
		$hours = array_fill( 0, 24, 0 );
		foreach ( Azl_Db::rows( "SELECT $hour AS h, COUNT(*) AS n FROM $t$w GROUP BY $hour", $args ) as $r ) {
			$hours[ (int) $r['h'] ] = (int) $r['n'];
		}
		$types = array();
		$by    = array();
		foreach ( Azl_Db::rows( "SELECT contact_type AS c, COUNT(*) AS n FROM $t$w GROUP BY contact_type", $args ) as $r ) {
			$by[ $r['c'] ] = (int) $r['n'];
		}
		foreach ( self::CONTACTS as $k => $l ) {
			$types[] = array( 'label' => $l, 'count' => $by[ $k ] ?? 0 );
		}
		$first = intdiv( $q['start'] + self::offset(), self::DAY_MS );
		$rows  = array();
		$trend = array();
		for ( $i = 0; $i < $q['days']; $i++ ) {
			$x       = $days[ $first + $i ] ?? array( 'n' => 0, 'closed' => 0, 'quick' => 0, 'in_house' => 0, 'external' => 0, 'checked_out' => 0 );
			$date    = self::day_date( $first + $i );
			$trend[] = array( 'date' => $date, 'count' => $x['n'] );
			$rows[]  = array( 'date' => $date, 'total' => $x['n'], 'inHouse' => $x['in_house'], 'external' => $x['external'], 'checkedOut' => $x['checked_out'], 'closed' => $x['closed'], 'quickPct' => self::pct( $x['quick'], $x['closed'] ) );
		}
		$by_hour = array();
		foreach ( $hours as $h => $n ) {
			$by_hour[] = array( 'hour' => $h, 'count' => $n );
		}
		$n = (int) $all['n'];
		return array(
			'headline' => self::fig( 'count', 'inquiries', $n, 'count' ),
			'summary'  => array(
				self::fig( 'count', 'Inquiries', $n, 'count' ),
				self::fig( 'perDay', 'Average per day', self::num( $n / max( 1, $q['days'] ), 1 ), 'count' ),
				self::fig( 'closed', 'Closed', (int) $all['closed'], 'count' ),
				self::fig( 'quickPct', 'Closed within 6 minutes', self::pct( $all['quick'], $all['closed'] ), 'pct' ),
				self::fig( 'closeAvg', 'Average time to close', self::min( $all['close_avg'] ), 'min' ),
			),
			'options'  => array( 'contact' => array_map( static fn( $k ) => array( 'value' => $k, 'label' => self::CONTACTS[ $k ] ), array_keys( self::CONTACTS ) ) ),
			'trend'    => $trend,
			'byHour'   => $by_hour,
			'byContact' => $types,
			'empty'    => 0 === $n,
			'table'    => array(
				'columns' => array( self::col( 'date', 'Date', 'date' ), self::col( 'total', 'Inquiries', 'count' ), self::col( 'inHouse', 'In-house guest', 'count' ), self::col( 'external', 'External', 'count' ), self::col( 'checkedOut', 'Checked-out guest', 'count' ), self::col( 'closed', 'Closed', 'count' ), self::col( 'quickPct', 'Closed within 6 min', 'pct' ) ),
				'rows'    => $rows,
			),
		);
	}

	/** The crisis log as an operational record: codes, places from the list, times and status. Never who, what or the room. */
	private static function crisis( array $q ): array {
		$t    = Azl_Db::t( 'crisis_cases' );
		$w    = ' WHERE occurred_at >= %d AND occurred_at < %d';
		$args = array( $q['start'], $q['end'] );
		if ( isset( $q['f']['code'] ) ) {
			$w     .= ' AND code = %s';
			$args[] = $q['f']['code'];
		}
		if ( isset( $q['f']['status'] ) ) {
			$w     .= ' AND status = %s';
			$args[] = $q['f']['status'];
		}
		$all   = Azl_Db::row( "SELECT COUNT(*) AS n, SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS closed, AVG(CASE WHEN status = 'resolved' AND resolved_at IS NOT NULL THEN resolved_at - occurred_at END) AS close_avg, SUM(CASE WHEN called911_at IS NOT NULL THEN 1 ELSE 0 END) AS called FROM $t$w", $args );
		$group = function ( string $col, string $list ) use ( $t, $w, $args ): array {
			$labels = self::labels( $list );
			$out    = array();
			foreach ( Azl_Db::rows( "SELECT $col AS k, COUNT(*) AS n FROM $t$w GROUP BY $col ORDER BY n DESC", $args ) as $r ) {
				$out[] = array( 'label' => null === $r['k'] ? 'Not given' : ( $labels[ $r['k'] ] ?? $r['k'] ), 'count' => (int) $r['n'] );
			}
			return $out;
		};
		$codes = self::labels( 'crisisCodes' );
		$cats  = self::labels( 'complaintCategories' );
		$locs  = self::labels( 'crisisLocations' );
		$rows  = array();
		foreach ( Azl_Db::rows( "SELECT cr_no, code, comp_cat, location, status, occurred_at, resolved_at, called911_at FROM $t$w ORDER BY occurred_at DESC, cr_no DESC LIMIT " . self::MAX_ROWS, $args ) as $r ) {
			$rows[] = array(
				'no'       => sprintf( 'CR-%04d', (int) $r['cr_no'] ),
				'code'     => null === $r['code'] ? '—' : ( $codes[ $r['code'] ] ?? $r['code'] ),
				'category' => null === $r['comp_cat'] ? '—' : ( $cats[ $r['comp_cat'] ] ?? $r['comp_cat'] ),
				'location' => null === $r['location'] ? '—' : ( $locs[ $r['location'] ] ?? $r['location'] ),
				'occurred' => (int) $r['occurred_at'],
				'closed'   => null === $r['resolved_at'] ? null : (int) $r['resolved_at'],
				'hours'    => null === $r['resolved_at'] ? null : self::hours( (int) $r['resolved_at'] - (int) $r['occurred_at'] ),
				'called'   => null === $r['called911_at'] ? 'No' : 'Yes',
				'status'   => self::CR_STATUS[ $r['status'] ] ?? $r['status'],
			);
		}
		$n = (int) $all['n'];
		return array(
			'headline'   => self::fig( 'count', 'cases', $n, 'count' ),
			'summary'    => array(
				self::fig( 'count', 'Cases', $n, 'count' ),
				self::fig( 'open', 'Still open', $n - (int) $all['closed'], 'count' ),
				self::fig( 'closeAvg', 'Average time to close', self::hours( $all['close_avg'] ), 'h' ),
				self::fig( 'called', 'BFP/911 called', (int) $all['called'], 'count' ),
			),
			'options'    => array( 'code' => self::options( 'crisisCodes' ), 'status' => array_map( static fn( $k ) => array( 'value' => $k, 'label' => self::CR_STATUS[ $k ] ), array_keys( self::CR_STATUS ) ) ),
			'byCode'     => $group( 'code', 'crisisCodes' ),
			'byCategory' => $group( 'comp_cat', 'complaintCategories' ),
			'byLocation' => $group( 'location', 'crisisLocations' ),
			'capped'     => $n > self::MAX_ROWS,
			'empty'      => 0 === $n,
			'table'      => array(
				'columns' => array( self::col( 'no', 'Case' ), self::col( 'code', 'Code' ), self::col( 'category', 'Category' ), self::col( 'location', 'Where' ), self::col( 'occurred', 'Occurred', 'time' ), self::col( 'closed', 'Closed', 'time' ), self::col( 'hours', 'Time to close', 'h' ), self::col( 'called', 'BFP/911 called' ), self::col( 'status', 'Status' ) ),
				'rows'    => $rows,
			),
		);
	}

	/* ---------- CSV ---------- */

	/** One CSV cell: numbers as they are; text quoted when needed, and never read as a formula. */
	public static function cell( $v ): string {
		if ( null === $v ) {
			return '';
		}
		if ( is_int( $v ) || is_float( $v ) ) {
			return (string) $v;
		}
		$s = (string) $v;
		if ( '' !== $s && false !== strpos( "=+-@\t\r", $s[0] ) ) {
			$s = "'" . $s;
		}
		return preg_match( '/[",\r\n]/', $s ) ? '"' . str_replace( '"', '""', $s ) . '"' : $s;
	}

	/** The table as CSV with a UTF-8 BOM. Units go in the headings; times are hotel time. */
	public static function csv( array $table ): string {
		$unit = array( 'min' => ' (min)', 'h' => ' (hours)', 'pct' => ' (%)', 'php' => ' (PHP)' );
		$head = array();
		foreach ( $table['columns'] as $c ) {
			$head[] = self::cell( $c['label'] . ( $unit[ $c['unit'] ] ?? '' ) );
		}
		$lines = array( implode( ',', $head ) );
		foreach ( $table['rows'] as $r ) {
			$cells = array();
			foreach ( $table['columns'] as $c ) {
				$v = $r[ $c['key'] ] ?? null;
				if ( 'time' === $c['unit'] && is_int( $v ) ) {
					$v = ( new DateTimeImmutable( '@' . intdiv( $v, 1000 ) ) )->setTimezone( new DateTimeZone( self::TZ ) )->format( 'Y-m-d H:i' );
				}
				$cells[] = self::cell( $v );
			}
			$lines[] = implode( ',', $cells );
		}
		return "\xEF\xBB\xBF" . implode( "\r\n", $lines ) . "\r\n";
	}

	/** "azalea-baguio-response-time-2026-10-01-to-2026-10-30.csv" */
	public static function filename( string $id, array $q ): string {
		$name = class_exists( 'Azl_Admin' ) ? (string) ( Azl_Admin::settings()['property_name'] ?? '' ) : '';
		$name = '' === trim( $name ) ? (string) get_bloginfo( 'name' ) : $name;
		$slug = static function ( string $s ): string {
			$s = function_exists( 'remove_accents' ) ? remove_accents( $s ) : $s;
			return trim( (string) preg_replace( '/[^a-z0-9]+/', '-', strtolower( $s ) ), '-' );
		};
		$hotel = substr( $slug( $name ), 0, 40 );
		return ( '' === $hotel ? 'hotel' : $hotel ) . '-' . $slug( self::TITLES[ $id ] ) . '-' . $q['from'] . '-to-' . $q['to'] . '.csv';
	}
}

Azl_Modules::register( new Azl_Module_Reports() );
Azl_Module_Reports::hooks();
