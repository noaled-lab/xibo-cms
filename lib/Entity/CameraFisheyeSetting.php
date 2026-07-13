<?php
namespace Xibo\Entity;

use Xibo\Service\LogServiceInterface;
use Xibo\Storage\StorageServiceInterface;

/**
 * Class CameraFisheyeSetting
 * Saved fisheye dewarp calibration for a Camera. Only ever edited from the
 * camera Edit form - the detail/viewing page may apply temporary overrides
 * (flip/direction) client-side only, those are never written back here.
 * @package Xibo\Entity
 */
class CameraFisheyeSetting implements \JsonSerializable
{
    use EntityTrait;

    public $cameraId;
    public $centerX = 50;
    public $centerY = 50;
    public $radius = 98;
    public $radiusInner = 0.25;
    public $radiusOuter = 1.0;
    public $rotationDeg = 0;
    public $lensCorrection = 0;
    public $fisheyeFov = 180;
    public $mode = 'seg';
    public $layout = 'L1';
    public $aspect = 6;
    public $flip = 0;
    public $direction = 'cw';

    /** @var array Default pane/PTZ presets */
    public $panes = [];

    /**
     * @param StorageServiceInterface $store
     * @param LogServiceInterface $log
     * @param \Symfony\Component\EventDispatcher\EventDispatcherInterface $dispatcher
     */
    public function __construct($store, $log, $dispatcher)
    {
        $this->setCommonDependencies($store, $log, $dispatcher);
    }

    public function save()
    {
        $this->getStore()->insert('
            INSERT INTO `camera_fisheye_setting`
                (`cameraId`, `centerX`, `centerY`, `radius`, `radiusInner`, `radiusOuter`, `rotationDeg`,
                 `lensCorrection`, `fisheyeFov`, `mode`, `layout`, `aspect`, `flip`, `direction`, `panes`, `modifiedDt`)
            VALUES
                (:cameraId, :centerX, :centerY, :radius, :radiusInner, :radiusOuter, :rotationDeg,
                 :lensCorrection, :fisheyeFov, :mode, :layout, :aspect, :flip, :direction, :panes, NOW())
            ON DUPLICATE KEY UPDATE
                `centerX` = :centerX2, `centerY` = :centerY2, `radius` = :radius2,
                `radiusInner` = :radiusInner2, `radiusOuter` = :radiusOuter2, `rotationDeg` = :rotationDeg2,
                `lensCorrection` = :lensCorrection2, `fisheyeFov` = :fisheyeFov2, `mode` = :mode2,
                `layout` = :layout2, `aspect` = :aspect2, `flip` = :flip2, `direction` = :direction2,
                `panes` = :panes2, `modifiedDt` = NOW()
        ', [
            'cameraId' => $this->cameraId,
            'centerX' => $this->centerX,
            'centerY' => $this->centerY,
            'radius' => $this->radius,
            'radiusInner' => $this->radiusInner,
            'radiusOuter' => $this->radiusOuter,
            'rotationDeg' => $this->rotationDeg,
            'lensCorrection' => $this->lensCorrection,
            'fisheyeFov' => $this->fisheyeFov,
            'mode' => $this->mode,
            'layout' => $this->layout,
            'aspect' => $this->aspect,
            'flip' => $this->flip ? 1 : 0,
            'direction' => $this->direction,
            'panes' => json_encode($this->panes),
            'centerX2' => $this->centerX,
            'centerY2' => $this->centerY,
            'radius2' => $this->radius,
            'radiusInner2' => $this->radiusInner,
            'radiusOuter2' => $this->radiusOuter,
            'rotationDeg2' => $this->rotationDeg,
            'lensCorrection2' => $this->lensCorrection,
            'fisheyeFov2' => $this->fisheyeFov,
            'mode2' => $this->mode,
            'layout2' => $this->layout,
            'aspect2' => $this->aspect,
            'flip2' => $this->flip ? 1 : 0,
            'direction2' => $this->direction,
            'panes2' => json_encode($this->panes),
        ]);
    }

    public function delete()
    {
        $this->getStore()->update(
            'DELETE FROM `camera_fisheye_setting` WHERE cameraId = :cameraId',
            ['cameraId' => $this->cameraId]
        );
    }

    /**
     * The saved calibration, shaped for the front-end dewarp module.
     * @return array
     */
    public function toParams(): array
    {
        return [
            'cx' => (float) $this->centerX,
            'cy' => (float) $this->centerY,
            'rad' => (float) $this->radius,
            'rin' => (float) $this->radiusInner,
            'rout' => (float) $this->radiusOuter,
            'rot' => (float) $this->rotationDeg,
            'lens' => (float) $this->lensCorrection,
            'ffov' => (float) $this->fisheyeFov,
            'mode' => $this->mode,
            'layout' => $this->layout,
            'aspect' => (float) $this->aspect,
            'flip' => (bool) $this->flip,
            'ccw' => $this->direction === 'ccw',
            'panes' => $this->panes,
        ];
    }
}
