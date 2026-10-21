<?php
/**
 * Run with PHP and the CMS's MYSQL_* environment. All SQL fixtures are temporary
 * tables scoped to this connection; camera writes use an in-memory store.
 * XIBO_TEST_AUTOLOAD may point to an installed CMS vendor/autoload.php.
 */
$root = dirname(__DIR__, 2);
require getenv('XIBO_TEST_AUTOLOAD') ?: $root . '/vendor/autoload.php';
require $root . '/lib/Controller/Camera.php';
require $root . '/lib/Support/DeviceScopeResolution.php';

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
$schemaStore = new class($pdo) {
    public function __construct(private PDO $pdo) {}
    public function select($sql, $params) {
        $query = $this->pdo->prepare($sql);
        $query->execute($params);
        return $query->fetchAll(PDO::FETCH_ASSOC);
    }
};
// Execute against the real schema before temporary fixtures can mask column errors.
check(\Xibo\Support\DeviceScopeResolution::resolve($schemaStore, -1), [0, 0],
    'Resolution query matches real CMS schema');
$pdo->exec('CREATE TEMPORARY TABLE display (displayId INT, resolution VARCHAR(100), displayProfileId INT DEFAULT 0, client_type VARCHAR(20) DEFAULT "windows")');
$pdo->exec('CREATE TEMPORARY TABLE displayprofile (displayProfileId INT, type VARCHAR(20), isDefault INT, config TEXT)');
$pdo->exec('CREATE TEMPORARY TABLE layout (layoutId INT, width DOUBLE, height DOUBLE)');
$pdo->exec('CREATE TEMPORARY TABLE resolution (resolutionId INT, intended_width INT, intended_height INT)');
$pdo->exec("INSERT INTO display (displayId, resolution) VALUES (1, '1920x1080'), (2, '3840x2160'), (3, '1080x1920'), (4, NULL),
    (5, '1920 × 1080')");
$pdo->exec('INSERT INTO layout VALUES (10,1920,1080), (11,1920,1080), (20,3840,2160),
    (30,1080,1920), (40,1920.4,1080)');
$pdo->exec('INSERT INTO resolution VALUES (1,1920,1080), (2,3840,2160), (3,1080,1920)');

$profile = $pdo->prepare('INSERT INTO displayprofile VALUES (?, ?, ?, ?)');
$profile->execute([1, 'windows', 0, '[{"name":"sizeX","value":1080},{"name":"sizeY","value":1920}]']);
$profile->execute([2, 'linux', 1, '[{"name":"sizeX","value":3840},{"name":"sizeY","value":2160}]']);
$pdo->exec("INSERT INTO display VALUES (6, '1920x1080', 1, 'windows'), (7, NULL, 0, 'linux')");
$resolutionStore = new class($pdo) {
    public function __construct(private PDO $pdo) {}
    public function select($sql, $params) {
        $query = $this->pdo->prepare($sql);
        $query->execute($params);
        return $query->fetchAll(PDO::FETCH_ASSOC);
    }
};
check(\Xibo\Support\DeviceScopeResolution::dimensions('1920x1080',
    '[{"name":"sizeX","value":1280},{"name":"sizeY","value":0}]'), [1280,1080], 'Automatic height uses reported height');
check(\Xibo\Support\DeviceScopeResolution::dimensions('1920x1080', 'invalid'), [1920,1080], 'Invalid config fallback');

foreach (['Layout' => 'layout', 'Resolution' => 'resolution'] as $factory => $table) {
    $source = file_get_contents($root . '/lib/Factory/' . $factory . 'Factory.php');
    if (!preg_match("~( AND " . $table . "\\.[^']*:scopeValid = 1 )~s", $source, $match)) {
        throw new RuntimeException('Scope predicate not found in ' . $factory);
    }
    $query = $pdo->prepare('SELECT ' . $table . 'Id FROM ' . $table . ' WHERE 1=1' . $match[1]
        . ' ORDER BY ' . $table . 'Id');
    $expected = $table === 'layout'
        ? [1 => [10, 11], 2 => [20], 3 => [30], 4 => [], 5 => [10, 11], 6 => [30], 7 => [20]]
        : [1 => [1], 2 => [2], 3 => [3], 4 => [], 5 => [1], 6 => [3], 7 => [2]];
    foreach ($expected as $displayId => $ids) {
        [$width, $height] = \Xibo\Support\DeviceScopeResolution::resolve($resolutionStore, $displayId);
        $query->execute(['scopeWidth' => $width, 'scopeHeight' => $height,
            'scopeValid' => (int) ($width > 0 && $height > 0)]);
        check(array_map('intval', $query->fetchAll(PDO::FETCH_COLUMN)), $ids,
            "$factory exact resolution for display $displayId");
    }
}

$pdo->exec('CREATE TEMPORARY TABLE campaign (campaignId INT, isLayoutSpecific INT, layoutId INT)');
$pdo->exec('INSERT INTO campaign VALUES (1,1,10), (2,1,30), (3,0,NULL)');
$source = file_get_contents($root . '/lib/Factory/CampaignFactory.php');
if (!preg_match("~( AND \\(campaign.isLayoutSpecific = 0 OR[^']+)~s", $source, $match)) {
    throw new RuntimeException('Campaign scope predicate missing');
}
$query = $pdo->prepare('SELECT campaign.campaignId FROM campaign LEFT JOIN layout
    ON layout.layoutId = campaign.layoutId WHERE 1=1' . $match[1] . ' ORDER BY campaign.campaignId');
foreach ([[1920,1080,1,[1,3]], [1080,1920,1,[2,3]], [0,0,0,[3]]] as [$w,$h,$valid,$ids]) {
    $query->execute(['scopeWidth' => $w, 'scopeHeight' => $h, 'scopeValid' => $valid]);
    check(array_map('intval', $query->fetchAll(PDO::FETCH_COLUMN)), $ids, 'Schedule search scopes layouts but retains campaigns');
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
