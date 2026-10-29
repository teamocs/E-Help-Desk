<?php
/**
 * Hazards, the safety words and statuses (fixed: they drive logic), plus the factory lists.
 *
 * DEPTS, PRESETS, BUNDLES, HOLD_REASONS, JOB_TITLES and WO_FINDINGS are only the SEED of each hotel's
 * own lists (Azl_Catalog, option azl_catalog). Nothing else reads them: the commands, staff admin and
 * snapshot read the catalog. Keep them equal to SEED_CATALOG in src/domain/catalog.ts.
 *
 * @package azl-ehd
 */

defined( 'ABSPATH' ) || exit;

final class Azl_Rules {

	const DEPTS = array(
		'housekeeping' => array( 'label' => 'Housekeeping', 'short' => 'HK', 'repairs' => false ),
		'engineering'  => array( 'label' => 'Engineering', 'short' => 'ENG', 'repairs' => true ),
		'it'           => array( 'label' => 'IT', 'short' => 'IT', 'repairs' => true ),
		'fnb'          => array( 'label' => 'Food & Beverage', 'short' => 'F&B', 'repairs' => false ),
		'frontdesk'    => array( 'label' => 'Front Desk', 'short' => 'FD', 'repairs' => false ),
		'security'     => array( 'label' => 'Security', 'short' => 'SEC', 'repairs' => false ),
	);

	/** key => [label, dept, SLA minutes, icon]. */
	const PRESETS = array(
		'towels'     => array( 'Extra towels', 'housekeeping', 10, 'towel' ),
		'pillow'     => array( 'Extra pillow', 'housekeeping', 10, 'bed' ),
		'toiletries' => array( 'Toiletries', 'housekeeping', 10, 'drop' ),
		'clean'      => array( 'Room cleaning', 'housekeeping', 30, 'broom' ),
		'inspection' => array( 'Checkout inspection', 'housekeeping', 25, 'check' ),
		'ac'         => array( 'AC not cold', 'engineering', 45, 'snow' ),
		'bulb'       => array( 'Light bulb', 'engineering', 30, 'bulb' ),
		'hotwater'   => array( 'No hot water', 'engineering', 30, 'flame' ),
		'wifi'       => array( 'Wi-Fi issue', 'it', 20, 'wifi' ),
		'tv'         => array( 'TV not working', 'it', 20, 'tv' ),
		'water'      => array( 'Bottled water', 'fnb', 10, 'bottle' ),
		'tray'       => array( 'Tray pickup', 'fnb', 15, 'tray' ),
		'late'       => array( 'Late checkout', 'frontdesk', 15, 'clock' ),
		'noise'      => array( 'Noise complaint', 'security', 10, 'ear' ),
	);

	/** Parts run in order; `after` is the index of the part that must be done first. */
	const BUNDLES = array(
		'leak' => array(
			'label' => 'Leak',
			'hint'  => 'Engineering fixes the source, Housekeeping cleans up after',
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

	/** Suggestions for the staff form's job title (free text stays allowed). */
	const JOB_TITLES = array(
		'head_desk_officer' => 'Head Desk Officer',
		'room_attendant'    => 'Room Attendant',
		'engineer'          => 'Engineer',
		'it_support'        => 'IT Support',
		'hk_supervisor'     => 'Housekeeping Supervisor',
		'duty_manager'      => 'Duty Manager',
		'night_engineer'    => 'Night Engineer',
	);

	/** One-tap findings when assessing a work order (stored as the assessment text). */
	const WO_FINDINGS = array(
		'worn_part'     => 'Worn part, replace',
		'leak_joint'    => 'Leak at joint, reseal',
		'repaint'       => 'Needs repainting',
		'vendor_repair' => 'Vendor repair needed',
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
