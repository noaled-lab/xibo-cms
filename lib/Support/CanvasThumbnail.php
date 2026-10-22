<?php

namespace Xibo\Support;

use Intervention\Image\ImageManagerStatic as Img;

/** Static image elements for the server-generated layout thumbnail. */
class CanvasThumbnail
{
    public static function render($image, array $elements, callable $imagePath, int $left = 0, int $top = 0): void
    {
        usort($elements, fn($a, $b) => ($a['layer'] ?? 0) <=> ($b['layer'] ?? 0));
        foreach ($elements as $element) {
            if (($element['isVisible'] ?? true) === false) {
                continue;
            }
            $width = (int) round($element['width'] ?? 0);
            $height = (int) round($element['height'] ?? 0);
            if ($width <= 0 || $height <= 0) {
                continue;
            }
            $x = $left + (int) round($element['left'] ?? 0);
            $y = $top + (int) round($element['top'] ?? 0);
            if (($element['id'] ?? '') !== 'global_library_image' || empty($element['mediaId'])) {
                $image->rectangle($x, $y, $x + $width, $y + $height, function ($draw) {
                    $draw->background('rgba(196, 196, 196, 0.6)');
                });
                continue;
            }
            $properties = [];
            foreach ($element['properties'] ?? [] as $property) {
                $properties[$property['id']] = $property['value'] ?? $property['default'] ?? null;
            }
            $cover = Img::make($imagePath((int) $element['mediaId']));
            $fit = $properties['objectFit'] ?? 'contain';
            $positionX = $properties['alignId'] ?? 'center';
            $positionY = $properties['valignId'] ?? 'middle';
            $position = ($positionY === 'middle' ? '' : $positionY . '-') . $positionX;
            if ($positionX === 'center' && $positionY !== 'middle') {
                $position = $positionY;
            }
            if ($fit === 'cover') {
                $cover->fit($width, $height);
            } else {
                $cover->resize($width, $height, function ($constraint) use ($fit) {
                    if ($fit !== 'fill') {
                        $constraint->aspectRatio();
                    }
                });
            }
            $box = Img::canvas($width, $height);
            $box->insert($cover, $position);
            $box->opacity(max(0, min(100, (int) ($properties['opacity'] ?? 100))));
            $rotation = (float) ($element['rotation'] ?? 0);
            if ($rotation != 0) {
                $box->rotate(-$rotation);
                $x -= (int) round(($box->width() - $width) / 2);
                $y -= (int) round(($box->height() - $height) / 2);
            }
            $image->insert($box, 'top-left', $x, $y);
        }
    }
}
