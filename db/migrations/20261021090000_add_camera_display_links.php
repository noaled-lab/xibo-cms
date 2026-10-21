<?php

use Phinx\Migration\AbstractMigration;

class AddCameraDisplayLinks extends AbstractMigration
{
    public function change()
    {
        $this->table('camera_display', ['id' => false, 'primary_key' => ['channelId', 'displayId']])
            ->addColumn('channelId', 'string', ['limit' => 255, 'collation' => 'utf8mb4_bin'])
            ->addColumn('displayId', 'integer')
            ->addIndex(['displayId'])
            ->addForeignKey('displayId', 'display', 'displayId', ['delete' => 'CASCADE'])
            ->create();
    }
}
