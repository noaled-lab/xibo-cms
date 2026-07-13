<?php
namespace Xibo\Factory;

use Xibo\Entity\Camera;
use Xibo\Entity\CameraFisheyeSetting;

/**
 * Class CameraFactory
 * Local (CMS-side) persistence for the camera page - camera "type" and,
 * for fisheye cameras, saved dewarp calibration. The channel itself
 * (name/url/on_demand) continues to live in the external rtsp-to-web
 * service and is not managed here.
 * @package Xibo\Factory
 */
class CameraFactory extends BaseFactory
{
    /**
     * @return Camera
     */
    public function createEmpty()
    {
        return new Camera($this->getStore(), $this->getLog(), $this->getDispatcher());
    }

    /**
     * @return CameraFisheyeSetting
     */
    public function createEmptyFisheyeSetting()
    {
        return new CameraFisheyeSetting($this->getStore(), $this->getLog(), $this->getDispatcher());
    }

    /**
     * @param string $streamId
     * @param string $channelId
     * @param string $type
     * @return Camera
     */
    public function create(string $streamId, string $channelId, string $type = Camera::TYPE_STANDARD)
    {
        $camera = $this->createEmpty();
        $camera->streamId = $streamId;
        $camera->channelId = $channelId;
        $camera->type = $type;

        return $camera;
    }

    /**
     * @param string $channelId
     * @return Camera|null
     */
    public function getByChannelId(string $channelId)
    {
        $rows = $this->getStore()->select(
            'SELECT * FROM `camera` WHERE channelId = :channelId',
            ['channelId' => $channelId]
        );

        if (count($rows) <= 0) {
            return null;
        }

        $camera = $this->createEmpty()->hydrate($rows[0], [
            'stringProperties' => ['streamId', 'channelId'],
        ]);

        if ($camera->isFisheye()) {
            $camera->fisheyeSetting = $this->getFisheyeSettingByCameraId($camera->cameraId);
        }

        return $camera;
    }

    /**
     * @param int $cameraId
     * @return CameraFisheyeSetting
     */
    public function getFisheyeSettingByCameraId(int $cameraId)
    {
        $rows = $this->getStore()->select(
            'SELECT * FROM `camera_fisheye_setting` WHERE cameraId = :cameraId',
            ['cameraId' => $cameraId]
        );

        $setting = $this->createEmptyFisheyeSetting();

        if (count($rows) > 0) {
            $setting->hydrate($rows[0]);
            $setting->panes = json_decode($setting->panes ?? '[]', true) ?: [];
        } else {
            $setting->cameraId = $cameraId;
        }

        return $setting;
    }
}
