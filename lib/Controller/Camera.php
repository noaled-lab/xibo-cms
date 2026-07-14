<?php
namespace Xibo\Controller;

use GuzzleHttp\Psr7\Stream;
use Slim\Http\Response as Response;
use Slim\Http\ServerRequest as Request;
use Xibo\Support\Exception\NotFoundException;

class Camera extends Base
{
    private $apiBaseUrl;

    const TYPE_STANDARD = 'standard';
    const TYPE_FISHEYE = 'fisheye';

    // TEMP: test-video upload is for verifying dewarp calibration before a live fisheye camera is available.
    // Remove testVideoUpload()/testVideoDownload()/testVideoDelete(), their routes, and testVideoDir() once
    // no longer needed.
    private const TEST_VIDEO_EXTENSIONS = ['mp4' => 'video/mp4', 'webm' => 'video/webm', 'mov' => 'video/quicktime'];
    private const TEST_VIDEO_MAX_BYTES = 200 * 1024 * 1024;

    public function __construct()
    {
        $username = getenv('RTSP_WEB_USERNAME') ?: 'admin';
        $password = getenv('RTSP_WEB_PASSWORD') ?: 'password';
        $host = getenv('RTSP_WEB_HOST') ?: 'rtsp-to-web:8083';

        $this->apiBaseUrl = sprintf('http://%s:%s@%s', $username, $password, $host);
    }

    // 기본 페이지
    public function displayPage(Request $request, Response $response) {
        $this->getState()->template = 'camera-page';
        return $this->render($request, $response);
    }

    // 카메라 목록 조회 (API 요청)
    public function search(Request $request, Response $response) {
        $cameras = [];

        try {
            $apiUrl = $this->apiBaseUrl . '/streams';

            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $apiUrl);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_TIMEOUT, 10);

            $result = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($httpCode === 200 && $result) {
                $data = json_decode($result, true);

                if ($data && isset($data['status']) && $data['status'] === 1 && isset($data['payload'])) {
                    foreach ($data['payload'] as $streamId => $stream) {
                        if (isset($stream['channels']) && is_array($stream['channels'])) {
                            foreach ($stream['channels'] as $channelId => $channel) {
                                $decoded = $this->decodeName($channel['name'] ?? '');

                                $cameras[] = [
                                    'name' => $decoded['name'],
                                    'streamId' => $streamId,
                                    'channelId' => $channelId,
                                    'url' => $this->generateWebSocketUrl($streamId, $channelId),
                                    'rtspUrl' => $channel['url'] ?? '',
                                    'streamName' => $stream['name'] ?? '',
                                    'onDemand' => $channel['on_demand'] ?? false,
                                    'status' => $channel['status'] ?? 0,
                                    'type' => $decoded['type'],
                                    'fisheyeParams' => $decoded['fisheyeParams'],
                                    'hasTestVideo' => $this->findTestVideoFile($channelId) !== null,
                                ];
                            }
                        }
                    }
                }
            }
        } catch (\Exception $e) {
            $this->getLog()->error('Failed to fetch camera streams: ' . $e->getMessage());
        }

        $this->getState()->hydrate([
            'data' => $cameras,
            'recordsTotal' => count($cameras),
            'recordsFiltered' => count($cameras)
        ]);

        return $this->render($request, $response);
    }

    // WebSocket URL 생성 헬퍼 함수
    private function generateWebSocketUrl($streamId, $channelId) {
        // 브라우저에서 window.location.hostname + 포트 8083을 사용하도록 경로만 반환
        return "/stream/{$streamId}/channel/{$channelId}/mse?uuid={$streamId}&channel={$channelId}";
    }

    /**
     * rtsp-to-web's channel schema is fixed to {name, url, on_demand, debug, status} - it has nowhere of its
     * own to store our camera "type" or fisheye calibration. Rather than adding CMS-side storage for it, we
     * pack that data into the `name` field as JSON when the camera is fisheye, prefixed with a marker that
     * cannot occur in a normal display name: MARKER + {"n":displayName,"t":"fisheye","f":calibration}.
     * Any name that doesn't start with the marker (every camera that predates this feature, or any plain
     * name someone happens to type) is treated as a "standard" camera name as-is - it is never parsed as
     * JSON, so there is no chance of an existing plain-text name being misread as calibration data.
     */
    private const NAME_ENCODING_MARKER = "\x01XIBO_FISHEYE\x01";

    private function decodeName(?string $rawName): array
    {
        $raw = (string) $rawName;

        if (str_starts_with($raw, self::NAME_ENCODING_MARKER)) {
            $decoded = json_decode(substr($raw, strlen(self::NAME_ENCODING_MARKER)), true);

            if (is_array($decoded) && ($decoded['t'] ?? null) === self::TYPE_FISHEYE) {
                return [
                    'name' => (string) ($decoded['n'] ?? ''),
                    'type' => self::TYPE_FISHEYE,
                    'fisheyeParams' => array_merge($this->defaultFisheyeParams(), is_array($decoded['f'] ?? null) ? $decoded['f'] : []),
                ];
            }
        }

        return [
            'name' => $raw,
            'type' => self::TYPE_STANDARD,
            'fisheyeParams' => null,
        ];
    }

    private function encodeName(string $displayName, string $type, ?array $fisheyeParams): string
    {
        if ($type === self::TYPE_FISHEYE) {
            return self::NAME_ENCODING_MARKER . json_encode(['n' => $displayName, 't' => self::TYPE_FISHEYE, 'f' => $fisheyeParams]);
        }

        return $displayName;
    }

    private function defaultFisheyeParams(): array
    {
        return [
            'cx' => 50, 'cy' => 50, 'rad' => 98, 'rin' => 0.25, 'rout' => 1.0,
            'rot' => 0, 'lens' => 0, 'ffov' => 180, 'mode' => 'seg', 'layout' => 'L1', 'aspect' => 6,
            'flip' => false, 'ccw' => false, 'panes' => [],
        ];
    }

    /**
     * Validate/clamp the calibration fields posted by the Edit form. This is the only place these values
     * are ever set - the detail/viewing page never writes them back.
     */
    private function buildFisheyeParamsFromRequest($sanitizedParams): array
    {
        $panes = json_decode($sanitizedParams->getString('panes'), true);

        return [
            'cx' => min(100, max(0, $sanitizedParams->getDouble('centerX'))),
            'cy' => min(100, max(0, $sanitizedParams->getDouble('centerY'))),
            'rad' => min(150, max(10, $sanitizedParams->getDouble('radius'))),
            'rin' => min(0.95, max(0, $sanitizedParams->getDouble('radiusInner'))),
            'rout' => min(1.2, max(0.1, $sanitizedParams->getDouble('radiusOuter'))),
            'rot' => min(360, max(0, $sanitizedParams->getDouble('rotationDeg'))),
            'lens' => min(0.5, max(-0.5, $sanitizedParams->getDouble('lensCorrection'))),
            'ffov' => min(230, max(150, $sanitizedParams->getDouble('fisheyeFov'))),
            'mode' => in_array($sanitizedParams->getString('mode'), ['seg', 'ptz'], true)
                ? $sanitizedParams->getString('mode') : 'seg',
            'layout' => in_array($sanitizedParams->getString('layout'), ['L1', 'L2H', 'L2V', 'L4', 'L13'], true)
                ? $sanitizedParams->getString('layout') : 'L1',
            'aspect' => $sanitizedParams->getDouble('aspect') ?: 6,
            'flip' => (bool) $sanitizedParams->getCheckbox('flip'),
            'ccw' => (bool) $sanitizedParams->getCheckbox('ccw'),
            'panes' => is_array($panes) ? $panes : [],
        ];
    }

    /**
     * Fetch a single channel's info (name/url/on_demand), decoded into our display name + type + calibration.
     * @return array|null
     */
    private function fetchChannel(string $streamId, string $channelId): ?array
    {
        try {
            $apiUrl = $this->apiBaseUrl . '/streams';
            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $apiUrl);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_TIMEOUT, 10);

            $result = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($httpCode === 200 && $result) {
                $data = json_decode($result, true);
                if ($data && isset($data['payload'][$streamId]['channels'][$channelId])) {
                    $channel = $data['payload'][$streamId]['channels'][$channelId];
                    $decoded = $this->decodeName($channel['name'] ?? '');

                    return [
                        'streamId' => $streamId,
                        'channelId' => $channelId,
                        'name' => $decoded['name'],
                        'type' => $decoded['type'],
                        'fisheyeParams' => $decoded['fisheyeParams'],
                        'url' => $channel['url'] ?? '',
                        'onDemand' => $channel['on_demand'] ?? false
                    ];
                }
            }
        } catch (\Exception $e) {
            $this->getLog()->error('Failed to fetch camera channel: ' . $e->getMessage());
        }

        return null;
    }

    // 채널 추가 폼
    public function addForm(Request $request, Response $response) {
        $this->getState()->template = 'camera-form-add';
        return $this->render($request, $response);
    }

    // 채널 추가 처리
    public function add(Request $request, Response $response) {
        $sanitizedParams = $this->getSanitizer($request->getParams());

        $streamId = $sanitizedParams->getString('streamId');
        $channelId = $this->uuidv4();
        $name = $sanitizedParams->getString('name');
        $url = $sanitizedParams->getString('url');
        $onDemand = $sanitizedParams->getInt('onDemand') === 1;
        $type = $sanitizedParams->getString('type') ?: self::TYPE_STANDARD;

        $encodedName = $this->encodeName(
            $name,
            $type,
            $type === self::TYPE_FISHEYE ? $this->defaultFisheyeParams() : null
        );

        try {
            $apiUrl = $this->apiBaseUrl . "/stream/{$streamId}/channel/{$channelId}/add";

            $postData = json_encode([
                'name' => $encodedName,
                'url' => $url,
                'on_demand' => $onDemand,
                'debug' => false,
                'status' => 0
            ]);

            $this->getLog()->debug('Camera add request - URL: ' . $apiUrl . ', Data: ' . $postData);

            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $apiUrl);
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, $postData);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
            curl_setopt($ch, CURLOPT_TIMEOUT, 10);

            $result = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $curlError = curl_error($ch);
            curl_close($ch);

            $this->getLog()->debug('Camera add response - HTTP Code: ' . $httpCode . ', Result: ' . $result . ', cURL Error: ' . $curlError);

            if ($httpCode === 200 && $result) {
                $data = json_decode($result, true);
                if ($data && isset($data['status']) && $data['status'] === 1) {
                    $this->getState()->hydrate([
                        'message' => __('카메라가 추가되었습니다.'),
                        'id' => $channelId,
                        'success' => true
                    ]);
                } else {
                    $errorMsg = isset($data['payload']) ? $data['payload'] : 'API returned error status';
                    throw new \Exception($errorMsg);
                }
            } else {
                $errorDetail = $result ? ' - Response: ' . $result : '';
                if ($curlError) {
                    $errorDetail .= ' - cURL Error: ' . $curlError;
                }
                throw new \Exception('API request failed with HTTP code: ' . $httpCode . $errorDetail);
            }
        } catch (\Exception $e) {
            $this->getLog()->error('Failed to add camera: ' . $e->getMessage());
            $this->getState()->hydrate([
                'message' => __('카메라 추가에 실패했습니다: ') . $e->getMessage(),
                'success' => false
            ]);
        }

        return $this->render($request, $response);
    }

    // 채널 수정 폼
    public function editForm(Request $request, Response $response, $id) {
        // $id는 "streamId:channelId" 형식으로 전달됨
        $parts = explode(':', $id);
        $streamId = $parts[0] ?? '';
        $channelId = $parts[1] ?? '';

        $channel = $this->fetchChannel($streamId, $channelId) ?? [
            'streamId' => $streamId,
            'channelId' => $channelId,
            'name' => '',
            'url' => '',
            'onDemand' => false,
            'type' => self::TYPE_STANDARD,
            'fisheyeParams' => null,
        ];
        $channel['id'] = $id;
        $channel['testVideoFile'] = $this->findTestVideoFile($channelId);

        $this->getState()->template = 'camera-form-edit';
        $this->getState()->setData([
            'camera' => $channel,
            'fisheyeParams' => $channel['fisheyeParams'] ?? $this->defaultFisheyeParams(),
        ]);

        return $this->render($request, $response);
    }

    // 채널 수정 처리
    public function edit(Request $request, Response $response, $id) {
        $parts = explode(':', $id);
        $streamId = $parts[0] ?? '';
        $channelId = $parts[1] ?? '';

        $sanitizedParams = $this->getSanitizer($request->getParams());
        $name = $sanitizedParams->getString('name');
        $url = $sanitizedParams->getString('url');
        $onDemand = $sanitizedParams->getInt('onDemand') === 1;
        $type = $sanitizedParams->getString('type') ?: self::TYPE_STANDARD;

        $fisheyeParams = $type === self::TYPE_FISHEYE ? $this->buildFisheyeParamsFromRequest($sanitizedParams) : null;
        $encodedName = $this->encodeName($name, $type, $fisheyeParams);

        try {
            $apiUrl = $this->apiBaseUrl . "/stream/{$streamId}/channel/{$channelId}/edit";

            $postData = json_encode([
                'name' => $encodedName,
                'url' => $url,
                'on_demand' => $onDemand,
                'debug' => false,
                'status' => 0
            ]);

            $this->getLog()->debug('Camera edit request - URL: ' . $apiUrl . ', Data: ' . $postData);

            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $apiUrl);
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, $postData);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
            curl_setopt($ch, CURLOPT_TIMEOUT, 10);

            $result = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $curlError = curl_error($ch);
            curl_close($ch);

            $this->getLog()->debug('Camera edit response - HTTP Code: ' . $httpCode . ', Result: ' . $result . ', cURL Error: ' . $curlError);

            if ($httpCode === 200 && $result) {
                $data = json_decode($result, true);
                if ($data && isset($data['status']) && $data['status'] === 1) {
                    if ($type !== self::TYPE_FISHEYE) {
                        // No longer fisheye - drop any test video too (idempotent if none exists).
                        $this->deleteTestVideoFiles($channelId);
                    }

                    $this->getState()->hydrate([
                        'message' => __('카메라가 수정되었습니다.'),
                        'id' => $id,
                        'success' => true
                    ]);
                } else {
                    $errorMsg = isset($data['payload']) ? $data['payload'] : 'API returned error status';
                    throw new \Exception($errorMsg);
                }
            } else {
                $errorDetail = $result ? ' - Response: ' . $result : '';
                if ($curlError) {
                    $errorDetail .= ' - cURL Error: ' . $curlError;
                }
                throw new \Exception('API request failed with HTTP code: ' . $httpCode . $errorDetail);
            }
        } catch (\Exception $e) {
            $this->getLog()->error('Failed to edit camera: ' . $e->getMessage());
            $this->getState()->hydrate([
                'message' => __('카메라 수정에 실패했습니다: ') . $e->getMessage(),
                'success' => false
            ]);
        }

        return $this->render($request, $response);
    }

    // 채널 삭제 폼
    public function deleteForm(Request $request, Response $response, $id) {
        $parts = explode(':', $id);
        $streamId = $parts[0] ?? '';
        $channelId = $parts[1] ?? '';

        $camera = [
            'streamId' => $streamId,
            'channelId' => $channelId,
            'name' => $channelId
        ];

        $this->getState()->template = 'camera-form-delete';
        $this->getState()->setData(['camera' => $camera]);

        return $this->render($request, $response);
    }

    // 채널 삭제 처리
    public function delete(Request $request, Response $response, $id) {
        $parts = explode(':', $id);
        $streamId = $parts[0] ?? '';
        $channelId = $parts[1] ?? '';

        try {
            $apiUrl = $this->apiBaseUrl . "/stream/{$streamId}/channel/{$channelId}/delete";

            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $apiUrl);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_TIMEOUT, 10);

            $result = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($httpCode === 200 && $result) {
                $data = json_decode($result, true);
                if ($data && isset($data['status']) && $data['status'] === 1) {
                    $this->deleteTestVideoFiles($channelId);

                    $this->getState()->hydrate([
                        'message' => __('카메라가 삭제되었습니다.'),
                        'id' => $id,
                        'success' => true
                    ]);
                } else {
                    throw new \Exception('API returned error status');
                }
            } else {
                throw new \Exception('API request failed with HTTP code: ' . $httpCode);
            }
        } catch (\Exception $e) {
            $this->getLog()->error('Failed to delete camera: ' . $e->getMessage());
            $this->getState()->hydrate([
                'message' => __('카메라 삭제에 실패했습니다: ') . $e->getMessage(),
                'success' => false
            ]);
        }

        return $this->render($request, $response);
    }

    // 카메라 상세 페이지
    public function detailPage(Request $request, Response $response, $id) {
        $parts = explode(':', $id);
        $streamId = $parts[0] ?? '';
        $channelId = $parts[1] ?? '';

        $channel = $this->fetchChannel($streamId, $channelId) ?? [
            'streamId' => $streamId,
            'channelId' => $channelId,
            'name' => $channelId,
            'url' => '',
            'onDemand' => false,
            'type' => self::TYPE_STANDARD,
            'fisheyeParams' => null,
        ];
        $channel['id'] = $id;
        $channel['testVideoFile'] = $this->findTestVideoFile($channelId);

        $this->getState()->template = 'camera-detail';
        $this->getState()->setData([
            'camera' => $channel,
            'fisheyeParams' => $channel['type'] === self::TYPE_FISHEYE ? $channel['fisheyeParams'] : null,
        ]);

        return $this->render($request, $response);
    }

    private function testVideoDir(): string
    {
        return rtrim($this->getConfig()->getSetting('LIBRARY_LOCATION'), '/') . '/camera_test/';
    }

    private function findTestVideoFile(string $channelId): ?string
    {
        foreach (array_keys(self::TEST_VIDEO_EXTENSIONS) as $ext) {
            $filename = $channelId . '.' . $ext;
            if (file_exists($this->testVideoDir() . $filename)) {
                return $filename;
            }
        }

        return null;
    }

    private function deleteTestVideoFiles(string $channelId): void
    {
        foreach (array_keys(self::TEST_VIDEO_EXTENSIONS) as $ext) {
            $path = $this->testVideoDir() . $channelId . '.' . $ext;
            if (file_exists($path)) {
                unlink($path);
            }
        }
    }

    // TEMP: 테스트용 영상 업로드 - 실제 어안 카메라 없이 디워핑을 확인하기 위한 임시 기능. 추후 제거.
    public function testVideoUpload(Request $request, Response $response, $id) {
        $parts = explode(':', $id);
        $channelId = $parts[1] ?? '';

        if (empty($_FILES['file']['tmp_name']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
            $this->getState()->hydrate([
                'message' => __('업로드할 파일을 선택하세요.'),
                'success' => false,
            ]);
            return $this->render($request, $response);
        }

        $originalName = $_FILES['file']['name'];
        $ext = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));

        if (!array_key_exists($ext, self::TEST_VIDEO_EXTENSIONS)) {
            $this->getState()->hydrate([
                'message' => __('지원하지 않는 파일 형식입니다 (mp4, webm, mov만 가능).'),
                'success' => false,
            ]);
            return $this->render($request, $response);
        }

        if ($_FILES['file']['size'] > self::TEST_VIDEO_MAX_BYTES) {
            $this->getState()->hydrate([
                'message' => __('파일이 너무 큽니다 (최대 200MB).'),
                'success' => false,
            ]);
            return $this->render($request, $response);
        }

        $this->deleteTestVideoFiles($channelId);

        $dir = $this->testVideoDir();
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        move_uploaded_file($_FILES['file']['tmp_name'], $dir . $channelId . '.' . $ext);

        $this->getState()->hydrate([
            'message' => __('테스트 영상이 업로드되었습니다.'),
            'success' => true,
        ]);

        return $this->render($request, $response);
    }

    // TEMP: 업로드된 테스트 영상 스트리밍 - 추후 제거.
    public function testVideoDownload(Request $request, Response $response, $id) {
        $this->setNoOutput();

        $parts = explode(':', $id);
        $channelId = $parts[1] ?? '';

        $filename = $this->findTestVideoFile($channelId);
        if ($filename === null) {
            throw new NotFoundException(__('테스트 영상을 찾을 수 없습니다.'));
        }

        $path = $this->testVideoDir() . $filename;
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        $mime = self::TEST_VIDEO_EXTENSIONS[$ext] ?? 'application/octet-stream';

        $response = $response
            ->withHeader('Content-Type', $mime)
            ->withHeader('Content-Length', filesize($path))
            ->withBody(new Stream(fopen($path, 'r')));

        return $this->render($request, $response);
    }

    // TEMP: 업로드된 테스트 영상 삭제 - 추후 제거.
    public function testVideoDelete(Request $request, Response $response, $id) {
        $parts = explode(':', $id);
        $channelId = $parts[1] ?? '';

        $this->deleteTestVideoFiles($channelId);

        $this->getState()->hydrate([
            'message' => __('테스트 영상이 삭제되었습니다.'),
            'success' => true,
        ]);

        return $this->render($request, $response);
    }

    private function uuidv4() {
        $data = random_bytes(16);
        $data[6] = chr((ord($data[6]) & 0x0f) | 0x40); // 버전 4
        $data[8] = chr((ord($data[8]) & 0x3f) | 0x80); // 변형
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
    }
}
