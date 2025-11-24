<?php
/**
 * 빈 레이아웃 생성 스크립트
 * 
 * 이 스크립트는 플레이어에서 빈 화면을 표시하기 위한 레이아웃을 생성합니다.
 * 
 * 사용법:
 * php bin/create-blank-layout.php [레이아웃 이름] [해상도 ID]
 * 
 * 예시:
 * php bin/create-blank-layout.php "빈 화면" 1
 */

use Xibo\Helper\Environment;
use Xibo\Helper\SanitizerService;

DEFINE('XIBO', true);
DEFINE('PROJECT_ROOT', realpath(__DIR__ . '/..'));

require PROJECT_ROOT . '/vendor/autoload.php';

if (!file_exists(PROJECT_ROOT . '/web/settings.php')) {
    die('설정 파일을 찾을 수 없습니다. Xibo가 설치되어 있는지 확인하세요.');
}

$app = require PROJECT_ROOT . '/lib/app.php';
$container = $app->getContainer();

// 명령줄 인자 처리
$layoutName = $argv[1] ?? '빈 화면';
$resolutionId = isset($argv[2]) ? (int)$argv[2] : null;

try {
    // 시스템 사용자 가져오기
    $user = $container->get('userFactory')->getSystemUser();
    
    // Factory 가져오기
    $layoutFactory = $container->get('layoutFactory');
    $resolutionFactory = $container->get('resolutionFactory');
    
    // 해상도 결정
    if ($resolutionId === null) {
        // 기본 해상도 가져오기 (1920x1080)
        $resolution = $resolutionFactory->getClosestMatchingResolution(1920, 1080);
        $resolutionId = $resolution->resolutionId;
        echo "해상도 ID를 지정하지 않아 기본 해상도({$resolution->width}x{$resolution->height})를 사용합니다.\n";
    } else {
        $resolution = $resolutionFactory->getById($resolutionId);
        echo "해상도: {$resolution->width}x{$resolution->height}\n";
    }
    
    // 빈 레이아웃 생성 (리전 없이)
    echo "빈 레이아웃 생성 중...\n";
    $layout = $layoutFactory->createFromResolution(
        $resolutionId,
        $user->userId,
        $layoutName,
        '플레이어에서 빈 화면을 표시하기 위한 레이아웃',
        [],
        null,
        false  // 리전 추가하지 않음
    );
    
    // 레이아웃 저장
    $layout->publishedStatusId = 2; // Published
    $layout->save();
    
    echo "레이아웃 저장 완료 (ID: {$layout->layoutId})\n";
    
    // XLF 파일 생성
    echo "XLF 파일 생성 중...\n";
    $layout->xlfToDisk([
        'notify' => false,
        'exceptionOnError' => true,
        'exceptionOnEmptyRegion' => false  // 빈 리전 허용
    ]);
    
    echo "\n성공! 빈 레이아웃이 생성되었습니다.\n";
    echo "레이아웃 ID: {$layout->layoutId}\n";
    echo "레이아웃 이름: {$layout->layout}\n";
    echo "\n이 레이아웃을 스케줄에 할당하면 플레이어에서 빈 화면이 표시됩니다.\n";
    
} catch (Exception $e) {
    echo "오류 발생: " . $e->getMessage() . "\n";
    echo "스택 트레이스:\n" . $e->getTraceAsString() . "\n";
    exit(1);
}

