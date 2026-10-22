<?php
// No database or library writes: exercise resolution selection with in-memory entities.
$root = dirname(__DIR__, 2);
require getenv('XIBO_TEST_AUTOLOAD') ?: $root . '/vendor/autoload.php';
require $root . '/lib/Factory/ResolutionFactory.php';
if (!function_exists('__')) {
    function __($message) { return $message; }
}
$factory = new class extends \Xibo\Factory\ResolutionFactory {
    public array $known = [];
    public function __construct() {}
    public function getClosestMatchingResolution($width, $height): \Xibo\Entity\Resolution {
        return $this->create('Default', $width, $height);
    }
    public function getByDimensions($width, $height) {
        return $this->known[$width . 'x' . $height]
            ?? throw new \Xibo\Support\Exception\NotFoundException('missing');
    }
    public function create($name, $width, $height) {
        $resolution = new class extends \Xibo\Entity\Resolution {
            public bool $saved = false;
            public function __construct() {}
            public function save($validate = true) { $this->validate(); $this->saved = true; }
        };
        $resolution->resolution = $name;
        $resolution->width = $width;
        $resolution->height = $height;
        return $resolution;
    }
};
function check($condition, $message) {
    if (!$condition) { throw new RuntimeException($message); }
    echo "PASS: $message\n";
}
$default = $factory->getForNewLayout(0, 0, 1);
check($default->width === 1920 && $default->height === 1080, 'All keeps the existing default');
$known = $factory->create('Portrait', 480, 960);
$factory->known['480x960'] = $known;
check($factory->getForNewLayout(480, 960, 1) === $known && !$known->saved, 'Exact resolution is reused');
$new = $factory->getForNewLayout(5280, 2160, 1);
check($new->width === 5280 && $new->height === 2160 && $new->saved && $new->userId === 1,
    'Missing resolution is created at exact dimensions');
$invalid = $factory->getForNewLayout(0, 960, 1);
check($invalid->width === 1920 && $invalid->height === 1080, 'Unknown dimensions preserve default behavior');
