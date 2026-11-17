<?php
// Read the duration of fragmented MP4 files, which getID3 cannot do.
$root = dirname(__DIR__, 2);
require $root . '/lib/Support/FragmentedMp4.php';

use Xibo\Support\FragmentedMp4;

$check = function ($label, $actual, $expected) {
    if ($actual !== $expected) {
        throw new RuntimeException($label . ': expected ' . var_export($expected, true)
            . ', got ' . var_export($actual, true));
    }
};

$check('fragmented', intval(FragmentedMp4::duration($root . '/tests/resources/fragmented-12s.mp4')), 12);
$check('regular mp4', FragmentedMp4::duration($root . '/tests/resources/HLH264.mp4'), null);
$check('not an mp4', FragmentedMp4::duration($root . '/tests/resources/sampleDocument.pdf'), null);
$check('missing file', FragmentedMp4::duration($root . '/tests/resources/missing.mp4'), null);

$file = getenv('XIBO_FRAGMENTED_MP4');
if ($file) {
    echo basename($file) . ': ' . FragmentedMp4::duration($file) . "s\n";
}

echo "PASS: fragmented mp4 duration, regular mp4, other and missing files\n";
