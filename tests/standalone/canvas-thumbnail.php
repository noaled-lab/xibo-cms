<?php
require getenv('XIBO_TEST_AUTOLOAD') ?: __DIR__ . '/../../vendor/autoload.php';
require __DIR__ . '/../../lib/Support/CanvasThumbnail.php';

use Intervention\Image\ImageManagerStatic as Img;
use Xibo\Support\CanvasThumbnail;

Img::configure(['driver' => 'gd']);
$path = tempnam(sys_get_temp_dir(), 'canvas-image-');
try {
    Img::canvas(40, 20, '#ff0000')->save($path, 100, 'png');
    $element = ['id' => 'global_library_image', 'mediaId' => 1,
        'left' => 10, 'top' => 10, 'width' => 40, 'height' => 40, 'layer' => 1];
    $render = function ($elements) use ($path) {
        $image = Img::canvas(80, 80, '#000000');
        CanvasThumbnail::render($image, $elements, fn($id) => $path);
        return $image;
    };
    $check = function ($image, $x, $y, $expected) {
        if ($image->pickColor($x, $y, 'hex') !== $expected) {
            throw new RuntimeException("Unexpected pixel at $x,$y");
        }
    };
    $image = $render([$element]);
    $check($image, 15, 15, '#000000');
    $check($image, 15, 25, '#ff0000');
    $check($image, 75, 75, '#000000');
    $element['properties'] = [['id' => 'objectFit', 'value' => 'fill']];
    $check($render([$element]), 15, 15, '#ff0000');
    $element['properties'] = [['id' => 'opacity', 'value' => 0]];
    $check($render([$element]), 15, 25, '#000000');
    $element['properties'] = [];
    $element['properties'] = [['id' => 'valignId', 'value' => 'top']];
    $check($render([$element]), 25, 15, '#ff0000');
    $element['properties'] = [];
    $element['rotation'] = 90;
    $check($render([$element]), 25, 15, '#ff0000');
    $element['isVisible'] = false;
    $check($render([$element]), 25, 15, '#000000');
    echo "PASS: canvas image placement, contain, fill, opacity, rotation and visibility\n";
} finally {
    unlink($path);
}
