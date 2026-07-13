<?php
namespace Xibo\Entity;

use Xibo\Service\LogServiceInterface;
use Xibo\Storage\StorageServiceInterface;

/**
 * Class Camera
 * Local storage for a camera channel (the channel itself lives in the
 * external rtsp-to-web service) - holds the camera "type" and,
 * for fisheye cameras, its saved dewarp calibration.
 * @package Xibo\Entity
 */
class Camera implements \JsonSerializable
{
    use EntityTrait;

    const TYPE_STANDARD = 'standard';
    const TYPE_FISHEYE = 'fisheye';

    public $cameraId;
    public $streamId;
    public $channelId;
    public $type = self::TYPE_STANDARD;

    /** @var string|null TEMP: test-only video used in place of the live stream - remove once no longer needed. */
    public $testVideoFile;

    public $createdDt;
    public $modifiedDt;

    /** @var CameraFisheyeSetting|null Populated by CameraFactory when type is fisheye */
    public $fisheyeSetting;

    /**
     * @param StorageServiceInterface $store
     * @param LogServiceInterface $log
     * @param \Symfony\Component\EventDispatcher\EventDispatcherInterface $dispatcher
     */
    public function __construct($store, $log, $dispatcher)
    {
        $this->setCommonDependencies($store, $log, $dispatcher);
    }

    public function isFisheye(): bool
    {
        return $this->type === self::TYPE_FISHEYE;
    }

    public function save()
    {
        if ($this->cameraId == null || $this->cameraId == 0) {
            $this->add();
        } else {
            $this->edit();
        }
    }

    private function add()
    {
        $this->cameraId = $this->getStore()->insert('
            INSERT INTO `camera` (`streamId`, `channelId`, `type`, `testVideoFile`, `createdDt`, `modifiedDt`)
              VALUES (:streamId, :channelId, :type, :testVideoFile, NOW(), NOW())
        ', [
            'streamId' => $this->streamId,
            'channelId' => $this->channelId,
            'type' => $this->type,
            'testVideoFile' => $this->testVideoFile,
        ]);
    }

    private function edit()
    {
        $this->getStore()->update('
            UPDATE `camera` SET
                `streamId` = :streamId,
                `type` = :type,
                `testVideoFile` = :testVideoFile,
                `modifiedDt` = NOW()
             WHERE cameraId = :cameraId
        ', [
            'cameraId' => $this->cameraId,
            'streamId' => $this->streamId,
            'type' => $this->type,
            'testVideoFile' => $this->testVideoFile,
        ]);
    }

    public function delete()
    {
        $this->getStore()->update(
            'DELETE FROM `camera` WHERE cameraId = :cameraId',
            ['cameraId' => $this->cameraId]
        );
    }
}
