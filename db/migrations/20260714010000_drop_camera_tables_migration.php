<?php
use Phinx\Migration\AbstractMigration;

/**
 * Class DropCameraTablesMigration
 * Reverts CreateCameraTablesMigration (20260713120000): the `camera`/`camera_fisheye_setting` tables
 * turned out not to be needed - the camera page instead packs its type/calibration data directly into
 * the rtsp-to-web channel `name` field (see Xibo\Controller\Camera::encodeName()/decodeName()).
 *
 * This is a new migration rather than deleting the old one, because the old one may already have been
 * run in some environments - phinx needs a matching migration file for every applied version, and an
 * environment that already ran it needs an explicit down step to remove the now-unused tables cleanly.
 */
class DropCameraTablesMigration extends AbstractMigration
{
    /** @inheritdoc */
    public function change()
    {
        if ($this->hasTable('camera_fisheye_setting')) {
            $this->table('camera_fisheye_setting')->drop()->save();
        }

        if ($this->hasTable('camera')) {
            $this->table('camera')->drop()->save();
        }
    }
}
