<?php
use Phinx\Migration\AbstractMigration;

class AddIsactiveToLkcommanddisplayprofileMigration extends AbstractMigration
{
    /** @inheritdoc */
    public function change()
    {
        $table = $this->table('lkcommanddisplayprofile');
        if (!$table->hasColumn('isActive')) {
            $table->addColumn('isActive', 'integer', [
                'limit' => \Phinx\Db\Adapter\MysqlAdapter::INT_TINY,
                'default' => 1,
                'null' => false,
                'comment' => 'Flag indicating if the command is enabled for this display profile'
            ])
            ->update();
        }
    }
}
