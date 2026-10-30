<?php
/**
 * Requests (sidebar module 2), wave 2 commands: editRequest, editItem, handOff, undoStep.
 *
 * The request and item code lives in Azl_Commands (edit_request, edit_item, hand_off, undo_step, with the undo
 * rules); this file only registers the commands with the module framework so that Azl_Access, which is not edited
 * for wave 2, knows they belong to Requests: the same role matrix row as relay, hold or transfer. Department staff
 * (own access) only reach items of their own department; editing a ticket needs full access (desk roles).
 *
 * No tables (the columns are in Azl_Schema, version 3) and no snapshot slice of its own: requests and items travel
 * in the snapshot's requests and items, as before.
 *
 * @package azl-ehd
 */

defined( 'ABSPATH' ) || exit;

final class Azl_Module_Requests extends Azl_Module {

	public function id(): string {
		return 'requests';
	}

	/** Department staff: true only for an item of their own department (an unknown item gets "Unknown item" later). */
	public static function own_item( array $cmd, array $who ): bool {
		if ( 'staff' !== ( $who['kind'] ?? null ) ) {
			return true;
		}
		$dept = Azl_Db::val( 'SELECT dept FROM ' . Azl_Db::t( 'items' ) . ' WHERE id = %s', array( (string) ( $cmd['itemId'] ?? '' ) ) );
		return null === $dept || $dept === $who['dept'];
	}

	public function commands(): array {
		$scope = array( self::class, 'own_item' );
		return array(
			'editRequest' => array(
				'ids'  => array( 'requestId' ),
				'need' => 'full',
				'run'  => static fn( array $cmd, Azl_Commands $ctx ) => $ctx->edit_request( $cmd ),
			),
			'editItem'    => array(
				'ids'   => array( 'itemId' ),
				'scope' => $scope,
				'run'   => static fn( array $cmd, Azl_Commands $ctx ) => $ctx->edit_item( $cmd ),
			),
			'handOff'     => array(
				'ids'   => array( 'itemId', 'newItemId' ),
				'scope' => $scope,
				'run'   => static fn( array $cmd, Azl_Commands $ctx ) => $ctx->hand_off( $cmd ),
			),
			'undoStep'    => array(
				'ids'   => array( 'itemId' ),
				'scope' => $scope,
				'run'   => static fn( array $cmd, Azl_Commands $ctx ) => $ctx->undo_step( $cmd ),
			),
		);
	}
}

Azl_Modules::register( new Azl_Module_Requests() );
