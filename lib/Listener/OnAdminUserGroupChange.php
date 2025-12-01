<?php
/**
 * Listener to handle admin user group changes
 */
namespace Xibo\Listener;

use Xibo\Event\AdminUserGroupChangedEvent;
use Xibo\Factory\DisplayGroupFactory;
use Xibo\Support\Exception\NotFoundException;

class OnAdminUserGroupChange
{
    /** @var DisplayGroupFactory */
    private $displayGroupFactory;

    public function __construct(DisplayGroupFactory $displayGroupFactory)
    {
        $this->displayGroupFactory = $displayGroupFactory;
    }

    public function __invoke(AdminUserGroupChangedEvent $event)
    {
        $oldGroup = $event->getOldGroup();
        $newGroup = $event->getNewGroup();

        // Get all existing display-specific groups
        try {
            $displayGroups = $this->displayGroupFactory->query(null, ['disableUserCheck' => 1, 'isDisplaySpecific' => 1]);

            foreach ($displayGroups as $dg) {
                // Remove permissions from old group if it exists
                if ($oldGroup !== null) {
                    try {
                        $dg->removePermissionForGroup($oldGroup->groupId);
                    } catch (\Exception $e) {
                        // Best-effort; cannot log here without logger, swallow exceptions
                    }
                }

                // Add permissions to new group if it exists
                if ($newGroup !== null) {
                    try {
                        $dg->addPermissionForGroup($newGroup->groupId, 1, 1, 1);
                    } catch (\Exception $e) {
                        // Best-effort; cannot log here without logger, swallow exceptions
                    }
                }
            }
        } catch (NotFoundException $e) {
            // No display-specific groups found; nothing to do
        }
    }
}
