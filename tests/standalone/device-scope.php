<?php
/**
 * Run with PHP and the CMS's MYSQL_* environment. All SQL fixtures are temporary
 * tables scoped to this connection; camera writes use an in-memory store.
 * XIBO_TEST_AUTOLOAD may point to an installed CMS vendor/autoload.php.
 */
$root = dirname(__DIR__, 2);
require getenv('XIBO_TEST_AUTOLOAD') ?: $root . '/vendor/autoload.php';
require $root . '/lib/Controller/Camera.php';

if (!function_exists('__')) {
    function __($message) { return $message; }
}

function check($actual, $expected, string $message): void
{
    if ($actual !== $expected) {
        throw new RuntimeException($message . ': ' . json_encode($actual));
    }
    echo "PASS: $message\n";
}

$pdo = new PDO(
    'mysql:host=' . (getenv('MYSQL_HOST') ?: 'cms-db') . ';dbname=' . getenv('MYSQL_DATABASE') . ';charset=utf8mb4',
    getenv('MYSQL_USER'), getenv('MYSQL_PASSWORD'), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
);
$pdo->exec('CREATE TEMPORARY TABLE display (displayId INT, resolution VARCHAR(100))');
$pdo->exec('CREATE TEMPORARY TABLE layout (layoutId INT, width DOUBLE, height DOUBLE)');
$pdo->exec('CREATE TEMPORARY TABLE resolution (resolutionId INT, intended_width INT, intended_height INT)');
$pdo->exec("INSERT INTO display VALUES (1, '1920x1080'), (2, '3840x2160'), (3, '1080x1920'), (4, NULL),
    (5, '1920 × 1080')");
$pdo->exec('INSERT INTO layout VALUES (10,1920,1080), (11,1920,1080), (20,3840,2160),
    (30,1080,1920), (40,1920.4,1080)');
$pdo->exec('INSERT INTO resolution VALUES (1,1920,1080), (2,3840,2160), (3,1080,1920)');

foreach (['Layout' => 'layout', 'Resolution' => 'resolution'] as $factory => $table) {
    $source = file_get_contents($root . '/lib/Factory/' . $factory . 'Factory.php');
    if (!preg_match('~\$body \.= "( AND EXISTS \(\s*SELECT 1 FROM display scopeDisplay.*?)";~s', $source, $match)) {
        throw new RuntimeException('Scope predicate not found in ' . $factory);
    }
    $query = $pdo->prepare('SELECT ' . $table . 'Id FROM ' . $table . ' WHERE 1=1' . $match[1]
        . ' ORDER BY ' . $table . 'Id');
    $expected = $table === 'layout'
        ? [1 => [10, 11], 2 => [20], 3 => [30], 4 => [], 5 => [10, 11]]
        : [1 => [1], 2 => [2], 3 => [3], 4 => [], 5 => [1]];
    foreach ($expected as $displayId => $ids) {
        $query->execute(['contextDisplayId' => $displayId]);
        check(array_map('intval', $query->fetchAll(PDO::FETCH_COLUMN)), $ids,
            "$factory exact resolution for display $displayId");
    }
}

$store = new class {
    public array $links = [1, 3];
    public function update($sql, $params) {
        $this->links = array_values(array_diff($this->links, [$params['displayId']]));
    }
    public function insert($sql, $params) { $this->links[] = $params['displayId']; }
};
$factory = new class {
    public function query($sort, $filter) {
        check($filter, [], 'Display lookup retains permission checks');
        return [(object) ['displayId' => 1], (object) ['displayId' => 2]];
    }
};
$camera = new \Xibo\Controller\Camera($store, $factory);
$save = new ReflectionMethod($camera, 'saveDisplayLinks');
$validate = new ReflectionMethod($camera, 'validateDisplayLinks');
$params = new class {
    public bool $submitted = true;
    public array $ids = [2, 2];
    public function hasParam($name) { return $this->submitted; }
    public function getIntArray($name, $options) { return $this->ids; }
};
check($validate->invoke($camera, $params), [2], 'Duplicate assignments removed');
$save->invoke($camera, 'camera-1', [2]);
check($store->links, [3, 2], 'Relinking preserves inaccessible assignments');
$save->invoke($camera, 'camera-1', []);
check($store->links, [3], 'Unlink only accessible displays');
$save->invoke($camera, 'camera-1', null);
check($store->links, [3], 'Legacy camera edits preserve assignments');
$params->ids = [3];
try {
    $validate->invoke($camera, $params);
    throw new RuntimeException('Unauthorized assignment accepted');
} catch (\Xibo\Support\Exception\AccessDeniedException $e) {
    echo "PASS: unauthorized assignment rejected\n";
}
$params->submitted = false;
check($validate->invoke($camera, $params), null, 'Older API clients can omit assignments');

$autoload = getenv('XIBO_TEST_AUTOLOAD') ?: $root . '/vendor/autoload.php';
$twig = new \Twig\Environment(new \Twig\Loader\FilesystemLoader([
    $root . '/views', dirname($autoload, 2) . '/views',
]));
$twig->addExtension(new \Xibo\Twig\TransExtension());
$twig->addFunction(new \Twig\TwigFunction('url_for', fn($name) => '/' . $name));
foreach (['authed', 'device-scope', 'camera-form-add', 'camera-form-edit', 'camera-display-fields'] as $view) {
    $twig->parse($twig->tokenize(new \Twig\Source(file_get_contents($root . '/views/' . $view . '.twig'), $view)));
    echo "PASS: Twig syntax $view\n";
}
$html = $twig->render('camera-display-fields.twig', [
    'displays' => [['displayId' => 1, 'display' => '<Lobby>'], ['displayId' => 2, 'display' => 'Entrance']],
    'linkedDisplayIds' => [2],
]);
check(str_contains($html, '&lt;Lobby&gt;'), true, 'Display names escaped in camera form');
check((bool) preg_match('/<option[^>]*value="2"[^>]*selected/', $html), true,
    'Saved camera assignments rendered as selected');
