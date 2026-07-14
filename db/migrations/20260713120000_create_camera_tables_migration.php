<?php
use Phinx\Migration\AbstractMigration;

/**
 * Class CreateCameraTablesMigration
 * Create local storage for the camera page (previously fully proxied to the
 * external rtsp-to-web service with no local persistence): camera type
 * (standard|fisheye) and, for fisheye cameras, saved dewarp calibration.
 */
class CreateCameraTablesMigration extends AbstractMigration
{
    /** @inheritdoc */
    public function change()
    {
        if (!$this->hasTable('camera')) {
            $this->table('camera', ['id' => 'cameraId'])
                ->addColumn('streamId', 'string', ['limit' => 50, 'null' => false])
                ->addColumn('channelId', 'string', ['limit' => 64, 'null' => false])
                ->addColumn('type', 'string', ['limit' => 20, 'null' => false, 'default' => 'standard'])
                // TEMP: for testing dewarp/calibration without a live camera - remove once no longer needed.
                ->addColumn('testVideoFile', 'string', ['limit' => 255, 'null' => true, 'default' => null])
                ->addColumn('createdDt', 'datetime', ['null' => true, 'default' => null])
                ->addColumn('modifiedDt', 'datetime', ['null' => true, 'default' => null])
                ->addIndex(['channelId'], ['unique' => true])
                ->create();
        }

        if (!$this->hasTable('camera_fisheye_setting')) {
            $this->table('camera_fisheye_setting', ['id' => false, 'primary_key' => ['cameraId']])
                ->addColumn('cameraId', 'integer', ['null' => false])
                ->addColumn('centerX', 'decimal', ['precision' => 5, 'scale' => 2, 'null' => false, 'default' => 50])
                ->addColumn('centerY', 'decimal', ['precision' => 5, 'scale' => 2, 'null' => false, 'default' => 50])
                ->addColumn('radius', 'decimal', ['precision' => 5, 'scale' => 2, 'null' => false, 'default' => 98])
                ->addColumn('radiusInner', 'decimal', ['precision' => 5, 'scale' => 3, 'null' => false, 'default' => 0.25])
                ->addColumn('radiusOuter', 'decimal', ['precision' => 5, 'scale' => 3, 'null' => false, 'default' => 1.0])
                ->addColumn('rotationDeg', 'decimal', ['precision' => 5, 'scale' => 1, 'null' => false, 'default' => 0])
                ->addColumn('lensCorrection', 'decimal', ['precision' => 4, 'scale' => 2, 'null' => false, 'default' => 0])
                ->addColumn('fisheyeFov', 'decimal', ['precision' => 5, 'scale' => 1, 'null' => false, 'default' => 180])
                ->addColumn('mode', 'string', ['limit' => 4, 'null' => false, 'default' => 'seg'])
                ->addColumn('layout', 'string', ['limit' => 10, 'null' => false, 'default' => 'L1'])
                ->addColumn('aspect', 'decimal', ['precision' => 6, 'scale' => 4, 'null' => false, 'default' => 6])
                // Saved defaults - editable only from the camera Edit form.
                // The detail/viewing page may temporarily override these client-side only; overrides are never saved.
                ->addColumn('flip', 'boolean', ['null' => false, 'default' => false])
                ->addColumn('direction', 'string', ['limit' => 3, 'null' => false, 'default' => 'cw'])
                ->addColumn('panes', 'text', ['null' => true, 'default' => null])
                ->addColumn('modifiedDt', 'datetime', ['null' => true, 'default' => null])
                ->addForeignKey('cameraId', 'camera', 'cameraId', ['delete' => 'CASCADE', 'update' => 'CASCADE'])
                ->create();
        }
    }
}
