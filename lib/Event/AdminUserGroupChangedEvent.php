<?php
/**
 * AdminUserGroupChangedEvent
 */
namespace Xibo\Event;

use Xibo\Entity\UserGroup;

class AdminUserGroupChangedEvent extends Event
{
    public static $NAME = 'admin.usergroup.change.event';

    /** @var UserGroup|null */
    private $oldGroup;
    /** @var UserGroup|null */
    private $newGroup;

    public function __construct($oldGroup = null, $newGroup = null)
    {
        $this->oldGroup = $oldGroup;
        $this->newGroup = $newGroup;
    }

    public function getOldGroup()
    {
        return $this->oldGroup;
    }

    public function getNewGroup()
    {
        return $this->newGroup;
    }
}
