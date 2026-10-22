<?php

namespace Xibo\Support;

/** Width and height of the resolution chosen on the display. */
class DeviceScopeResolution
{
    public static function resolve($store, int $displayId): array
    {
        $rows = $store->select('SELECT r.intended_width, r.intended_height
            FROM `display` d
            LEFT JOIN `resolution` r ON r.resolutionId = d.scopeResolutionId
            WHERE d.displayId = :displayId', ['displayId' => $displayId]);
        if (empty($rows) || !is_numeric($rows[0]['intended_width'] ?? null)
            || !is_numeric($rows[0]['intended_height'] ?? null)
        ) {
            return [0, 0];
        }
        $width = (int) $rows[0]['intended_width'];
        $height = (int) $rows[0]['intended_height'];
        return $width > 0 && $height > 0 ? [$width, $height] : [0, 0];
    }
}
