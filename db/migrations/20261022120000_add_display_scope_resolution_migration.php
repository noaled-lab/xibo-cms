<?php

use Phinx\Migration\AbstractMigration;

/**
 * Resolution chosen on a display for the top menu filter.
 * @phpcs:disable PSR1.Classes.ClassDeclaration.MissingNamespace
 */
class AddDisplayScopeResolutionMigration extends AbstractMigration
{
    public function change()
    {
        $this->table('display')
            ->addColumn('scopeResolutionId', 'integer', [
                'null' => true,
                'default' => null,
            ])
            ->addForeignKey('scopeResolutionId', 'resolution', 'resolutionId', [
                'delete' => 'SET_NULL',
                'update' => 'NO_ACTION',
            ])
            ->save();
    }
}
