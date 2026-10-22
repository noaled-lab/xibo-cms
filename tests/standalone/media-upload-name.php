<?php
// Exercise real media validation without writing any library files or database rows.
$root = dirname(__DIR__, 2);
require getenv('XIBO_TEST_AUTOLOAD') ?: $root . '/vendor/autoload.php';
require $root . '/lib/Entity/Media.php';
if (!function_exists('__')) {
    function __($message) { return $message; }
}

function mediaFor($name, array $names)
{
    $store = new class($names) {
        public function __construct(private array $names) {}
        public function select($sql, $params) {
            foreach ($this->names as [$owner, $name]) {
                if ($owner === $params['userId'] && mb_strtolower($name) === mb_strtolower($params['name'])) {
                    return [['mediaId' => 1, 'name' => $name, 'apiRef' => null]];
                }
            }
            return [];
        }
    };
    $media = new class($store) extends \Xibo\Entity\Media {
        public function __construct(private $testStore) {}
        protected function getStore() { return $this->testStore; }
    };
    $media->name = $name;
    $media->mediaType = 'image';
    $media->setOwner(7);
    return $media;
}

function checkName($input, $names, $expected) {
    $media = mediaFor($input, $names);
    $media->validate(['oldMedia' => null, 'renameOnConflict' => true]);
    if ($media->name !== $expected || mb_strlen($media->name) > 100) {
        throw new RuntimeException('Unexpected name: ' . $media->name);
    }
    echo "PASS: $expected\n";
}
checkName('포스터.jpg', [], '포스터.jpg');
checkName('포스터.jpg', [[7, '포스터.jpg'], [7, '포스터 (2).jpg']], '포스터 (3).jpg');
checkName('포스터.jpg', [[8, '포스터.jpg']], '포스터.jpg');
checkName('Poster.JPG', [[7, 'poster.jpg']], 'Poster (2).JPG');
checkName('홍보', [[7, '홍보']], '홍보 (2)');
$long = str_repeat('가', 96) . '.jpg';
checkName($long, [[7, $long]], str_repeat('가', 92) . ' (2).jpg');
foreach ([['oldMedia' => null], ['oldMedia' => new stdClass(), 'renameOnConflict' => true]] as $options) {
    $media = mediaFor('포스터.jpg', [[7, '포스터.jpg']]);
    if ($options['oldMedia'] !== null) {
        $options['oldMedia']->name = '포스터.jpg';
    }
    try {
        $media->validate($options);
        throw new RuntimeException('Normal validation/replacement unexpectedly renamed media');
    } catch (\Xibo\Support\Exception\DuplicateEntityException $e) {
        echo "PASS: normal validation and replacement keep existing behavior\n";
    }
}
