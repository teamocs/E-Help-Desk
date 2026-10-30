<?php
/**
 * A tiny module that exists only in the tests (tests/ is left out of the plugin zip). It proves the framework end to
 * end: its own table and counter, two commands (one needs full access), a snapshot slice with progress notes from
 * azl_updates, an editable list, and access rows for a module id that is not in the built-in matrix.
 */

class Azl_Module_Example extends Azl_Module {

	/** @var string bumped by a test to prove a module upgrade */
	public $ver = '1';

	public function id(): string {
		return 'example';
	}

	public function version(): string {
		return $this->ver;
	}

	public function schema() {
		return 'CREATE TABLE ' . Azl_Db::t( 'example_notes' ) . " (
  id char(36) NOT NULL,
  note_no int(11) unsigned NOT NULL,
  text text NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'open',
  op_id char(36) NOT NULL,
  created_at bigint(20) NOT NULL,
  updated_at bigint(20) NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY note_no (note_no),
  UNIQUE KEY op_id (op_id)
) " . Azl_Schema::table_options() . ';';
	}

	public function sequences(): array {
		return array( 'ex' );
	}

	public function capabilities(): array {
		return array( 'owner' => 'full', 'manager' => 'full', 'supervisor' => 'read', 'hdo' => 'own', 'staff' => 'none' );
	}

	public function catalogLists(): array {
		return array(
			'exampleTags' => array(
				'label'    => array( 'tag', 'tags' ),
				'maxItems' => 3,
				'fields'   => array( array( 'name' => 'color', 'label' => 'colour', 'type' => 'text', 'max' => 10, 'required' => true ) ),
				'seed'     => array( array( 'label' => 'Urgent', 'color' => 'red' ) ),
			),
		);
	}

	public function commands(): array {
		return array(
			'addExampleNote'   => array(
				'ids'      => array( 'noteId' ),
				'validate' => static function ( array $cmd ): ?string {
					return '' === Azl_Commands::para( $cmd['text'] ?? null ) ? 'Write the note' : null;
				},
				'run'      => array( $this, 'add' ),
				'prior'    => static function ( string $id ): array {
					$n = Azl_Db::val( 'SELECT note_no FROM ' . Azl_Db::t( 'example_notes' ) . ' WHERE id = %s', array( $id ) );
					return null === $n ? array() : array( 'noteNo' => (int) $n );
				},
			),
			'closeExampleNote' => array(
				'ids'  => array( 'noteId' ),
				'need' => 'full',
				'run'  => array( $this, 'close' ),
			),
		);
	}

	public function add( array $cmd, Azl_Commands $ctx ): array {
		$text = Azl_Commands::para( $cmd['text'] );
		if ( ! $ctx->claim( 'example', $cmd['noteId'], 'Noted' ) ) {
			return $ctx->replay( $cmd );
		}
		$n = Azl_Db::bump( 'ex' );
		Azl_Db::insert(
			'example_notes',
			array(
				'id'         => $cmd['noteId'],
				'note_no'    => $n,
				'text'       => $text,
				'op_id'      => $ctx->op(),
				'created_at' => $ctx->now(),
				'updated_at' => $ctx->now(),
			)
		);
		Azl_Updates::add( 'example', $cmd['noteId'], 'First look: ' . $text, $ctx->actor(), $ctx->op(), $ctx->now() );
		return Azl_Commands::ok( array( 'noteNo' => $n ) );
	}

	public function close( array $cmd, Azl_Commands $ctx ): array {
		$st = Azl_Db::val( 'SELECT status FROM ' . Azl_Db::t( 'example_notes' ) . ' WHERE id = %s' . Azl_Db::lock(), array( $cmd['noteId'] ) );
		if ( null === $st ) {
			return Azl_Commands::fail( 'Unknown note' );
		}
		if ( ! $ctx->claim( 'example', $cmd['noteId'], 'Closed' ) ) {
			return $ctx->replay( $cmd );
		}
		Azl_Db::update( 'example_notes', array( 'status' => 'closed', 'updated_at' => $ctx->now() ), array( 'id' => $cmd['noteId'] ) );
		return Azl_Commands::ok();
	}

	public function snapshot( array $who ): array {
		$rows    = Azl_Db::rows( 'SELECT id, note_no, text, status FROM ' . Azl_Db::t( 'example_notes' ) . ' ORDER BY note_no' );
		$updates = Azl_Updates::list( 'example', array_column( $rows, 'id' ) );
		$out     = array();
		foreach ( $rows as $r ) {
			$out[] = array(
				'id'      => $r['id'],
				'no'      => 'EX-' . Azl_Rules::pad( (int) $r['note_no'] ),
				'text'    => $r['text'],
				'status'  => $r['status'],
				'updates' => $updates[ $r['id'] ] ?? array(),
			);
		}
		return array( 'notes' => $out );
	}
}
