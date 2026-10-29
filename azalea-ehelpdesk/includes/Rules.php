<?php
/**
 * Port of src/domain/rules.ts: departments, presets with SLA minutes, bundles, hold reasons,
 * hazards and the safety words. Keep in step with the TypeScript file; the client uses the same lists.
 *
 * @package azl-ehd
 */

defined( 'ABSPATH' ) || exit;

final class Azl_Rules {

	const DEPTS = array(
		'housekeeping' => array( 'label' => 'Housekeeping', 'short' => 'HK' ),
		'engineering'  => array( 'label' => 'Engineering', 'short' => 'ENG' ),
		'it'           => array( 'label' => 'IT', 'short' => 'IT' ),
		'fnb'          => array( 'label' => 'Food & Beverage', 'short' => 'F&B' ),
		'frontdesk'    => array( 'label' => 'Front Desk', 'short' => 'FD' ),
		'security'     => array( 'label' => 'Security', 'short' => 'SEC' ),
	);

	/** key => [label, dept, SLA minutes]. */
	const PRESETS = array(
		'towels'     => array( 'Extra towels', 'housekeeping', 10 ),
		'pillow'     => array( 'Extra pillow', 'housekeeping', 10 ),
		'toiletries' => array( 'Toiletries', 'housekeeping', 10 ),
		'clean'      => array( 'Room cleaning', 'housekeeping', 30 ),
		'inspection' => array( 'Checkout inspection', 'housekeeping', 25 ),
		'ac'         => array( 'AC not cold', 'engineering', 45 ),
		'bulb'       => array( 'Light bulb', 'engineering', 30 ),
		'hotwater'   => array( 'No hot water', 'engineering', 30 ),
		'wifi'       => array( 'Wi-Fi issue', 'it', 20 ),
		'tv'         => array( 'TV not working', 'it', 20 ),
		'water'      => array( 'Bottled water', 'fnb', 10 ),
		'tray'       => array( 'Tray pickup', 'fnb', 15 ),
		'late'       => array( 'Late checkout', 'frontdesk', 15 ),
		'noise'      => array( 'Noise complaint', 'security', 10 ),
	);

	/** Parts run in order; `after` is the index of the part that must be done first. */
	const BUNDLES = array(
		'leak' => array(
			'label' => 'Leak',
			'parts' => array(
				array( 'name' => 'Leak: fix source', 'dept' => 'engineering', 'slaMin' => 20 ),
				array( 'name' => 'Leak: clean up', 'dept' => 'housekeeping', 'slaMin' => 25, 'after' => 0 ),
			),
		),
	);

	const HOLD_REASONS = array(
		'parts'          => 'Waiting for parts',
		'no_access'      => 'No access to room',
		'dnd'            => 'Guest on Do Not Disturb',
		'vendor'         => 'Waiting for vendor',
		'guest_declined' => 'Guest declined for now',
	);

	const HAZARDS = array(
		'smoke'   => 'Smoke or fire',
		'gas'     => 'Gas smell',
		'flood'   => 'Flooding',
		'medical' => 'Medical distress',
		'threat'  => 'Threat or violence',
		'lift'    => 'Trapped in a lift',
	);

	const OPEN_STATUSES   = array( 'new', 'relayed', 'on_site', 'on_hold' );
	const CLOSED_STATUSES = array( 'done', 'transferred', 'escalated', 'cant_do', 'duplicate', 'cancelled' );

	const SAFETY_RULES = array(
		'smoke'   => '/\b(smoke|smoking|fire|burning|usok|sunog|nasusunog|apoy)\b/iu',
		'gas'     => '/\b(gas smell|smells? (of )?gas|gas leak|amoy gas|lpg)\b/iu',
		'flood'   => '/\b(flood|flooding|baha|bumabaha)\b/iu',
		'medical' => '/\b(can\'?t breathe|cannot breathe|hindi makahinga|nahihirapan huminga|chest pain|unconscious|collapsed|seizure|nawalan ng malay)\b/iu',
		'threat'  => '/\b(gun|knife|weapon|threaten(ing)?|baril|patalim|saksak|armado)\b/iu',
		'lift'    => '/\b(stuck in (the )?(lift|elevator)|trapped|naipit|na-?stuck sa (lift|elevator))\b/iu',
	);

	/** Runs before and outside any classifier. A false alarm costs minutes; a miss costs more. */
	public static function detect_safety( string $text ): ?string {
		foreach ( self::SAFETY_RULES as $hazard => $re ) {
			if ( preg_match( $re, $text ) ) {
				return $hazard;
			}
		}
		return null;
	}

	/** pad(7) is "0007", pad(7, 3) is "007". */
	public static function pad( int $n, int $w = 4 ): string {
		return str_pad( (string) $n, $w, '0', STR_PAD_LEFT );
	}
}
