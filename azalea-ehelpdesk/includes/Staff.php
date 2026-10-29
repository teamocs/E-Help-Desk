<?php
/**
 * Port of src/server/staff.ts and policy.ts: staff records, PIN sign-in with lockout, and who is
 * acting on a command. One install is one property, so every staff row works here.
 *
 * Lockout: five wrong PINs lock that person for 15 minutes, counted per person (never per device).
 * Wrong PIN, unknown person, inactive person, no PIN set and a locked person all get the same answer.
 *
 * @package azl-ehd
 */

defined( 'ABSPATH' ) || exit;

final class Azl_Staff {

	const ROLES        = array( 'hdo', 'staff', 'supervisor' );
	const WRONG        = 'That name and PIN do not match.';
	const WEAK         = 'Pick a PIN that is not a repeat or a straight run, like 1111 or 1234.';
	const PIN_FORMAT   = 'The PIN must be four digits.';
	const UNKNOWN      = 'Unknown person.';
	const LOCK_TRIES   = 5;
	const LOCK_MINUTES = 15;
	const SIGN_IN      = 'Sign in with your PIN first.';
	const TOKEN_ENDED  = 'Your PIN sign-in has ended. Sign in with your PIN.';

	private static function fail( string $error ): array {
		return array( 'ok' => false, 'error' => $error );
	}

	public static function initials( string $name ): string {
		$words = preg_split( '/\s+/u', trim( $name ), -1, PREG_SPLIT_NO_EMPTY );
		$out   = '';
		foreach ( array_slice( $words ? $words : array(), 0, 2 ) as $w ) {
			$out .= mb_strtoupper( mb_substr( $w, 0, 1 ) );
		}
		return '' === $out ? '?' : $out;
	}

	private static function line( $v ): string {
		return is_string( $v ) ? trim( sanitize_text_field( $v ) ) : '';
	}

	/** The first problem with a staff record, or null. */
	private static function problem( array $in ): ?string {
		$name  = self::line( $in['name'] ?? null );
		$title = self::line( $in['title'] ?? null );
		if ( mb_strlen( $name ) < 1 || mb_strlen( $name ) > 80 ) {
			return 'Enter a name of up to 80 characters.';
		}
		if ( mb_strlen( $title ) < 1 || mb_strlen( $title ) > 60 ) {
			return 'Enter a job title of up to 60 characters.';
		}
		if ( ! in_array( $in['role'] ?? null, self::ROLES, true ) ) {
			return 'Pick a role.';
		}
		$dept = $in['dept'] ?? null;
		if ( null !== $dept && ! ( is_string( $dept ) && isset( Azl_Rules::DEPTS[ $dept ] ) ) ) {
			return 'Pick a department.';
		}
		return null;
	}

	private static function pin_problem( $pin ): ?string {
		if ( ! Azl_Pin::valid( $pin ) ) {
			return self::PIN_FORMAT;
		}
		return Azl_Pin::is_weak( $pin ) ? self::WEAK : null;
	}

	/** null, or a positive id of an existing WordPress user. False when invalid. */
	private static function wp_user( $v ) {
		if ( null === $v ) {
			return null;
		}
		if ( ! is_int( $v ) || $v <= 0 || ( function_exists( 'get_userdata' ) && ! get_userdata( $v ) ) ) {
			return false;
		}
		return $v;
	}

	/**
	 * Adds a person. $in: name, title, role, dept (or null), optional wpUserId linking a manager's own
	 * WordPress account. @return array{ok: bool, id?: string, error?: string}
	 */
	public static function create( array $in, $pin ): array {
		$bad = self::problem( $in ) ?? self::pin_problem( $pin );
		if ( null !== $bad ) {
			return self::fail( $bad );
		}
		$wp_user = self::wp_user( $in['wpUserId'] ?? null );
		if ( false === $wp_user ) {
			return self::fail( 'Unknown WordPress user.' );
		}
		$name = self::line( $in['name'] );
		$id   = Azl_Db::uuid();
		$now  = Azl_Db::now();
		return Azl_Db::transaction(
			function () use ( $in, $pin, $name, $id, $now, $wp_user ) {
				Azl_Db::insert(
					'staff',
					array(
						'id'         => $id,
						'wp_user_id' => $wp_user,
						'name'       => $name,
						'initials'   => self::initials( $name ),
						'role'       => $in['role'],
						'title'      => self::line( $in['title'] ),
						'dept'       => $in['dept'] ?? null,
						'on_shift'   => 1,
						'active'     => 1,
						'pin_hash'   => Azl_Pin::hash( $pin ),
						'pin_failed' => 0,
						'created_at' => $now,
						'updated_at' => $now,
					)
				);
				Azl_Db::bump( 'change' );
				return array( true, array( 'ok' => true, 'id' => $id ) );
			}
		);
	}

	/**
	 * Changes a person. Any of: name, title, role, dept, onShift (bool), active (false deactivates),
	 * pin, wpUserId. Fields left out stay as they are.
	 */
	public static function update( $id, array $in ): array {
		if ( ! Azl_Db::is_uuid( $id ) ) {
			return self::fail( self::UNKNOWN );
		}
		$id = strtolower( $id );
		return Azl_Db::transaction(
			function () use ( $id, $in ) {
				$t   = Azl_Db::t( 'staff' );
				$cur = Azl_Db::row( "SELECT name, title, role, dept, active FROM $t WHERE id = %s" . Azl_Db::lock(), array( $id ) );
				if ( null === $cur || '1' !== (string) $cur['active'] ) {
					return array( false, self::fail( self::UNKNOWN ) );
				}
				$next = array(
					'name'  => array_key_exists( 'name', $in ) ? $in['name'] : $cur['name'],
					'title' => array_key_exists( 'title', $in ) ? $in['title'] : $cur['title'],
					'role'  => array_key_exists( 'role', $in ) ? $in['role'] : $cur['role'],
					'dept'  => array_key_exists( 'dept', $in ) ? $in['dept'] : $cur['dept'],
				);
				$bad = self::problem( $next );
				if ( null === $bad && array_key_exists( 'pin', $in ) ) {
					$bad = self::pin_problem( $in['pin'] );
				}
				foreach ( array( 'onShift', 'active' ) as $flag ) {
					if ( null === $bad && array_key_exists( $flag, $in ) && ! is_bool( $in[ $flag ] ) ) {
						$bad = 'Choose yes or no.';
					}
				}
				$wp_user = self::wp_user( $in['wpUserId'] ?? null );
				if ( null === $bad && false === $wp_user ) {
					$bad = 'Unknown WordPress user.';
				}
				if ( null !== $bad ) {
					return array( false, self::fail( $bad ) );
				}
				$name = self::line( $next['name'] );
				$data = array(
					'name'       => $name,
					'initials'   => self::initials( $name ),
					'title'      => self::line( $next['title'] ),
					'role'       => $next['role'],
					'dept'       => $next['dept'],
					'updated_at' => Azl_Db::now(),
				);
				if ( array_key_exists( 'wpUserId', $in ) ) {
					$data['wp_user_id'] = $wp_user;
				}
				if ( array_key_exists( 'onShift', $in ) ) {
					$data['on_shift'] = $in['onShift'] ? 1 : 0;
				}
				if ( array_key_exists( 'pin', $in ) ) {
					$data['pin_hash']         = Azl_Pin::hash( $in['pin'] );
					$data['pin_failed']       = 0;
					$data['pin_locked_until'] = null;
				}
				if ( false === ( $in['active'] ?? true ) ) {
					$data['active']   = 0;
					$data['on_shift'] = 0;
				}
				Azl_Db::update( 'staff', $data, array( 'id' => $id ) );
				Azl_Db::bump( 'change' );
				return array( true, array( 'ok' => true ) );
			}
		);
	}

	public static function change_pin( $id, $pin ): array {
		return self::update( $id, array( 'pin' => $pin ) );
	}

	public static function deactivate( $id ): array {
		return self::update( $id, array( 'active' => false ) );
	}

	/**
	 * Checks a PIN. The person's row is locked for the check, so parallel tries are counted in turn.
	 * A failure is committed; everything else about the answer is the same as for a stranger.
	 */
	public static function check_pin( $staff_id, $pin ): array {
		if ( ! Azl_Db::is_uuid( $staff_id ) || ! Azl_Pin::valid( $pin ) ) {
			Azl_Pin::burn();
			return self::fail( self::WRONG );
		}
		$staff_id = strtolower( $staff_id );
		return Azl_Db::transaction(
			function () use ( $staff_id, $pin ) {
				$t   = Azl_Db::t( 'staff' );
				$row = Azl_Db::row(
					"SELECT pin_hash, pin_failed, pin_locked_until FROM $t WHERE id = %s AND active = 1" . Azl_Db::lock(),
					array( $staff_id )
				);
				$now = Azl_Db::now();
				if ( null === $row || empty( $row['pin_hash'] ) || ( null !== $row['pin_locked_until'] && (int) $row['pin_locked_until'] > $now ) ) {
					Azl_Pin::burn();
					return array( false, self::fail( self::WRONG ) );
				}
				if ( Azl_Pin::verify( $pin, $row['pin_hash'] ) ) {
					Azl_Db::update( 'staff', array( 'pin_failed' => 0, 'pin_locked_until' => null ), array( 'id' => $staff_id ) );
					return array( true, array( 'ok' => true ) );
				}
				$failed = (int) $row['pin_failed'] + 1;
				$data   = array( 'pin_failed' => $failed );
				if ( $failed >= self::LOCK_TRIES ) {
					$data = array( 'pin_failed' => 0, 'pin_locked_until' => $now + self::LOCK_MINUTES * 60000 );
				}
				Azl_Db::update( 'staff', $data, array( 'id' => $staff_id ) );
				return array( true, self::fail( self::WRONG ) );
			}
		);
	}

	/**
	 * Who acts on a command (port of policy.ts needsStaff + actor.ts readActor).
	 * - A valid token: the staff member it names.
	 * - A token that is present but no longer valid: refused, so nobody acts under the wrong name.
	 * - No token, and the account may act directly (manager, supervisor, administrator): the staff row
	 *   linked to that WordPress user, or null ("a manager").
	 * - No token on a shared-device account: refused.
	 *
	 * @return array{ok: true, staff: ?string}|array{ok: false, error: string}
	 */
	public static function actor_for( int $user_id, $token ): array {
		if ( is_string( $token ) && '' !== $token ) {
			$staff = Azl_Pin::read_actor( $token, $user_id );
			return null === $staff ? self::fail( self::TOKEN_ENDED ) : array( 'ok' => true, 'staff' => $staff );
		}
		if ( Azl_Caps::needs_staff( user_can( $user_id, Azl_Caps::DIRECT ), null ) ) {
			return self::fail( self::SIGN_IN );
		}
		$linked = Azl_Db::val(
			'SELECT id FROM ' . Azl_Db::t( 'staff' ) . ' WHERE wp_user_id = %d AND active = 1 ORDER BY created_at, id LIMIT 1',
			array( $user_id )
		);
		return array( 'ok' => true, 'staff' => $linked );
	}
}
