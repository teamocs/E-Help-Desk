<?php
/**
 * Progress notes any module can attach to its records (work-order updates, house-status updates, crisis-case
 * updates): table azl_updates. One row per note; the same op adding the same note twice adds one row (unique
 * op_id + entity + entity_id), so a replayed command never doubles a note.
 *
 * Call add() inside a command, after the command's claim (Azl_Commands::claim), with $ctx->op() and $ctx->now().
 *
 * @package azl-ehd
 */

defined( 'ABSPATH' ) || exit;

final class Azl_Updates {

	const TEXT_MAX = 2000;
	const ENTITY   = '/^[a-z][a-z0-9_]{1,19}\z/';

	/**
	 * Adds a note. $by is the staff id who wrote it, or null for a manager account.
	 *
	 * @return bool False when this op already added this note (nothing changed).
	 * @throws InvalidArgumentException For an entity name, id, op id or text that is not valid.
	 */
	public static function add( string $entity, string $entity_id, string $text, ?string $by, string $op_id, int $at ): bool {
		$text = trim( $text );
		if ( ! preg_match( self::ENTITY, $entity ) || ! Azl_Db::is_uuid( $entity_id ) || ! Azl_Db::is_uuid( $op_id ) || ( null !== $by && ! Azl_Db::is_uuid( $by ) ) ) {
			throw new InvalidArgumentException( 'Not a valid update reference' );
		}
		if ( '' === $text || mb_strlen( $text ) > self::TEXT_MAX ) {
			throw new InvalidArgumentException( 'An update needs 1 to ' . self::TEXT_MAX . ' characters' );
		}
		$sql = Azl_Db::insert_ignore() . ' INTO ' . Azl_Db::t( 'updates' )
			. ' (entity, entity_id, text, by_staff, op_id, created_at, updated_at) VALUES (%s, %s, %s, ' . Azl_Db::literal( null === $by ? null : strtolower( $by ) ) . ', %s, %d, %d)';
		return Azl_Db::exec( $sql, array( $entity, strtolower( $entity_id ), $text, strtolower( $op_id ), $at, $at ) ) > 0;
	}

	/**
	 * The notes of many records at once, oldest first.
	 *
	 * @return array<string, array<int, array{at: int, by: string, text: string}>> entity id => notes
	 */
	public static function list( string $entity, array $ids ): array {
		$out = array();
		$ids = array_values( array_filter( $ids, array( 'Azl_Db', 'is_uuid' ) ) );
		foreach ( array_chunk( $ids, 500 ) as $chunk ) {
			$rows = Azl_Db::rows(
				'SELECT entity_id, text, by_staff, created_at FROM ' . Azl_Db::t( 'updates' ) . ' WHERE entity = %s AND entity_id IN ('
					. Azl_Db::in( $chunk ) . ') ORDER BY created_at, id',
				array_merge( array( $entity ), $chunk )
			);
			foreach ( $rows as $r ) {
				$out[ $r['entity_id'] ][] = array(
					'at'   => (int) $r['created_at'],
					'by'   => $r['by_staff'] ?? 'system',
					'text' => $r['text'],
				);
			}
		}
		return $out;
	}
}
