<?php

namespace Xibo\Support;

/** Resolve the configured playback area, falling back to reported dimensions. */
class DeviceScopeResolution
{
    public static function resolve($store, int $displayId): array
    {
        $rows = $store->select('SELECT d.resolution, p.config
            FROM display d LEFT JOIN displayprofile p ON
                p.displayProfileId = d.displayProfileId
                OR (COALESCE(d.displayProfileId, 0) = 0
                    AND p.type = d.client_type AND p.isDefault = 1)
            WHERE d.displayId = :displayId', ['displayId' => $displayId]);
        if (empty($rows)) {
            return [0, 0];
        }
        return self::dimensions($rows[0]['resolution'] ?? '', $rows[0]['config'] ?? '');
    }

    public static function dimensions(string $reported, string $config): array
    {
        $width = $height = 0;
        if (preg_match('/^\s*(\d+)\s*[x×]\s*(\d+)\s*$/iu', $reported, $match)) {
            $width = (int) $match[1];
            $height = (int) $match[2];
        }
        $settings = json_decode($config, true);
        foreach (is_array($settings) ? $settings : [] as $setting) {
            $name = lcfirst($setting['name'] ?? '');
            $value = $setting['value'] ?? 0;
            if (in_array($name, ['sizeX', 'sizeY'], true) && is_numeric($value) && $value > 0) {
                // Fractional pixel dimensions must not silently match another resolution.
                $dimension = floor((float) $value) == (float) $value ? (int) $value : 0;
                if ($name === 'sizeX') {
                    $width = $dimension;
                } else {
                    $height = $dimension;
                }
            }
        }
        return [$width, $height];
    }
}
