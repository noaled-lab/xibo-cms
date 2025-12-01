<?php
/**
 * Copyright (C) 2025 Xibo Signage Ltd
 *
 * Xibo - Digital Signage - http://www.xibo.org.uk
 *
 * This file is part of Xibo.
 *
 * Xibo is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * Xibo is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Xibo.  If not, see <http://www.gnu.org/licenses/>.
 */

use Phinx\Migration\AbstractMigration;

class AddAdminUsergroupSettingMigration extends AbstractMigration
{
    /** @inheritdoc */
    public function change()
    {
        $existingSetting = $this->fetchRow('SELECT * FROM `setting` WHERE setting = \'ADMIN_USERGROUP\'');
        
        if (!$existingSetting) {
            // Add ADMIN_USERGROUP setting with no default value
            $this->table('setting')->insert([
                [
                    'setting' => 'ADMIN_USERGROUP',
                    'value' => '',
                    'userSee' => 1,
                    'userChange' => 1
                ]
            ])->save();
        } else {
            // Update existing setting to be editable
            $this->execute('UPDATE `setting` SET userChange = 1, userSee = 1 WHERE setting = \'ADMIN_USERGROUP\'');
        }
    }
}
