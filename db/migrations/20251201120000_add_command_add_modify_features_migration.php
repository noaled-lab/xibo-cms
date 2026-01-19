<?php
/**
 * Add command.add and command.modify features to user groups
 * @phpcs:disable PSR1.Classes.ClassDeclaration.MissingNamespace
 */

use Phinx\Migration\AbstractMigration;

/**
 * Class AddCommandAddModifyFeaturesMigration
 */
class AddCommandAddModifyFeaturesMigration extends AbstractMigration
{
    /** @inheritDoc */
    public function change()
    {
        // Update Display Manager group to include command.add and command.modify features
        $displayManagerGroup = $this->fetchRow('SELECT groupId, features FROM `group` WHERE `group` = \'Display Manager\' AND isUserSpecific = 0');
        
        if ($displayManagerGroup) {
            $features = json_decode($displayManagerGroup['features'], true);
            
            // Add command.add and command.modify if command.view exists and they don't already exist
            if (in_array('command.view', $features)) {
                if (!in_array('command.add', $features)) {
                    // Insert command.add right after command.view
                    $index = array_search('command.view', $features);
                    array_splice($features, $index + 1, 0, 'command.add');
                }
                if (!in_array('command.modify', $features)) {
                    // Insert command.modify right after command.add
                    $addIndex = array_search('command.add', $features);
                    array_splice($features, $addIndex + 1, 0, 'command.modify');
                }
                if (!in_array('command.send', $features)) {
                    $modifyIndex = array_search('command.modify', $features);
                    array_splice($features, $modifyIndex + 1, 0, 'command.send');
                }
                
                $this->execute(sprintf(
                    'UPDATE `group` SET features = \'%s\' WHERE groupId = %d',
                    json_encode($features),
                    $displayManagerGroup['groupId']
                ));
            }
        }
        
        // Update any other groups that have command.view to also include command.add and command.modify
        $otherGroups = $this->fetchAll('
            SELECT groupId, features 
            FROM `group` 
            WHERE isUserSpecific = 0 
              AND `group` != \'Display Manager\'
              AND features LIKE \'%command.view%\'
        ');
        
        foreach ($otherGroups as $group) {
            $features = json_decode($group['features'], true);
            
            if (in_array('command.view', $features)) {
                if (!in_array('command.add', $features)) {
                    $index = array_search('command.view', $features);
                    array_splice($features, $index + 1, 0, 'command.add');
                }
                if (!in_array('command.modify', $features)) {
                    $addIndex = array_search('command.add', $features);
                    array_splice($features, $addIndex + 1, 0, 'command.modify');
                }
                if (!in_array('command.send', $features)) {
                    $modifyIndex = array_search('command.modify', $features);
                    array_splice($features, $modifyIndex + 1, 0, 'command.send');
                }
                
                $this->execute(sprintf(
                    'UPDATE `group` SET features = \'%s\' WHERE groupId = %d',
                    json_encode($features),
                    $group['groupId']
                ));
            }
        }
    }
}
