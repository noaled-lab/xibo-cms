<?php
namespace Xibo\Controller;

use GuzzleHttp\Psr7\Stream;
use Slim\Http\Response as Response;
use Slim\Http\ServerRequest as Request;
use Xibo\Entity\Camera as CameraEntity;
use Xibo\Factory\CameraFactory;
use Xibo\Support\Exception\NotFoundException;

class Camera extends Base
{
    private $apiBaseUrl;

    /** @var CameraFactory */
    private $cameraFactory;

    // TEMP: test-video upload is for verifying dewarp calibration before a live fisheye camera is available.
    // Remove testVideoUpload()/testVideoDownload()/testVideoDelete(), their routes, and the `testVideoFile`
    // column once no longer needed.
    private const TEST_VIDEO_EXTENSIONS = ['mp4' => 'video/mp4', 'webm' => 'video/webm', 'mov' => 'video/quicktime'];
    private const TEST_VIDEO_MAX_BYTES = 200 * 1024 * 1024;

    public function __construct(CameraFactory $cameraFactory)
    {
        $this->cameraFactory = $cameraFactory;

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
                                $localCamera = $this->cameraFactory->getByChannelId($channelId);

                                $cameras[] = [
                                    'name' => $channel['name'] ?? '',
                                    'streamId' => $streamId,
                                    'channelId' => $channelId,
                                    'url' => $this->generateWebSocketUrl($streamId, $channelId),
                                    'rtspUrl' => $channel['url'] ?? '',
                                    'streamName' => $stream['name'] ?? '',
                                    'onDemand' => $channel['on_demand'] ?? false,
                                    'status' => $channel['status'] ?? 0,
                                    'type' => $localCamera->type ?? CameraEntity::TYPE_STANDARD,
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
     * Fetch a single channel's info (name/url/on_demand) from rtsp-to-web.
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
                    return [
                        'streamId' => $streamId,
                        'channelId' => $channelId,
                        'name' => $channel['name'] ?? '',
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

    /**
     * Local camera row for a channel, or a transient (unsaved) default one
     * for channels that predate local camera storage.
     */
    private function getOrBuildLocalCamera(string $streamId, string $channelId): CameraEntity
    {
        return $this->cameraFactory->getByChannelId($channelId)
            ?? $this->cameraFactory->create($streamId, $channelId, CameraEntity::TYPE_STANDARD);
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
        $type = $sanitizedParams->getString('type') ?: CameraEntity::TYPE_STANDARD;

        try {
            $apiUrl = $this->apiBaseUrl . "/stream/{$streamId}/channel/{$channelId}/add";

            $postData = json_encode([
                'name' => $name,
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
                    // Create the local record (type + fisheye defaults, if applicable).
                    $camera = $this->cameraFactory->create($streamId, $channelId, $type);
                    $camera->save();

                    if ($camera->isFisheye()) {
                        $setting = $this->cameraFactory->createEmptyFisheyeSetting();
                        $setting->cameraId = $camera->cameraId;
                        $setting->save();
                    }

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
            'onDemand' => false
        ];

        $localCamera = $this->getOrBuildLocalCamera($streamId, $channelId);
        $channel['type'] = $localCamera->type;
        $channel['id'] = $id;
        $channel['testVideoFile'] = $localCamera->testVideoFile;

        $fisheyeParams = $localCamera->cameraId
            ? $this->cameraFactory->getFisheyeSettingByCameraId($localCamera->cameraId)->toParams()
            : $this->cameraFactory->createEmptyFisheyeSetting()->toParams();

        $this->getState()->template = 'camera-form-edit';
        $this->getState()->setData([
            'camera' => $channel,
            'fisheyeParams' => $fisheyeParams,
            'mseUrl' => $this->generateWebSocketUrl($streamId, $channelId),
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
        $type = $sanitizedParams->getString('type') ?: CameraEntity::TYPE_STANDARD;

        try {
            $apiUrl = $this->apiBaseUrl . "/stream/{$streamId}/channel/{$channelId}/edit";

            $postData = json_encode([
                'name' => $name,
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
                    $camera = $this->getOrBuildLocalCamera($streamId, $channelId);
                    $camera->type = $type;
                    $camera->save();

                    if ($camera->isFisheye()) {
                        $this->saveFisheyeSetting($camera->cameraId, $sanitizedParams);
                    } else {
                        // Type is no longer fisheye - drop any saved calibration (idempotent if none exists).
                        $setting = $this->cameraFactory->createEmptyFisheyeSetting();
                        $setting->cameraId = $camera->cameraId;
                        $setting->delete();
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

    /**
     * Validate and persist the fisheye calibration fields posted by the Edit form.
     * This is the only place these values are ever written.
     */
    private function saveFisheyeSetting(int $cameraId, $sanitizedParams): void
    {
        $setting = $this->cameraFactory->getFisheyeSettingByCameraId($cameraId);

        $setting->centerX = min(100, max(0, $sanitizedParams->getDouble('centerX')));
        $setting->centerY = min(100, max(0, $sanitizedParams->getDouble('centerY')));
        $setting->radius = min(150, max(10, $sanitizedParams->getDouble('radius')));
        $setting->radiusInner = min(0.95, max(0, $sanitizedParams->getDouble('radiusInner')));
        $setting->radiusOuter = min(1.2, max(0.1, $sanitizedParams->getDouble('radiusOuter')));
        $setting->rotationDeg = min(360, max(0, $sanitizedParams->getDouble('rotationDeg')));
        $setting->lensCorrection = min(0.5, max(-0.5, $sanitizedParams->getDouble('lensCorrection')));
        $setting->fisheyeFov = min(230, max(150, $sanitizedParams->getDouble('fisheyeFov')));
        $setting->mode = in_array($sanitizedParams->getString('mode'), ['seg', 'ptz'], true)
            ? $sanitizedParams->getString('mode') : 'seg';
        $setting->layout = in_array($sanitizedParams->getString('layout'), ['L1', 'L2H', 'L2V', 'L4', 'L13'], true)
            ? $sanitizedParams->getString('layout') : 'L1';
        $setting->aspect = $sanitizedParams->getDouble('aspect') ?: 6;
        $setting->flip = $sanitizedParams->getCheckbox('flip') ? 1 : 0;
        $setting->direction = $sanitizedParams->getCheckbox('ccw') ? 'ccw' : 'cw';

        $panes = json_decode($sanitizedParams->getString('panes'), true);
        $setting->panes = is_array($panes) ? $panes : [];

        $setting->save();
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
                    $camera = $this->cameraFactory->getByChannelId($channelId);
                    if ($camera !== null) {
                        $this->deleteTestVideoFile($camera);
                        $camera->delete();
                    }

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
            'onDemand' => false
        ];

        $camera = $this->getOrBuildLocalCamera($streamId, $channelId);
        $channel['type'] = $camera->type;
        $channel['id'] = $id;
        $channel['testVideoFile'] = $camera->testVideoFile;

        $fisheyeParams = ($camera->isFisheye() && $camera->cameraId)
            ? $this->cameraFactory->getFisheyeSettingByCameraId($camera->cameraId)->toParams()
            : null;

        $this->getState()->template = 'camera-detail';
        $this->getState()->setData([
            'camera' => $channel,
            'mseUrl' => $this->generateWebSocketUrl($streamId, $channelId),
            'fisheyeParams' => $fisheyeParams,
        ]);

        return $this->render($request, $response);
    }

    // TEMP: 테스트용 영상 업로드 - 실제 어안 카메라 없이 디워핑을 확인하기 위한 임시 기능. 추후 제거.
    public function testVideoUpload(Request $request, Response $response, $id) {
        $parts = explode(':', $id);
        $streamId = $parts[0] ?? '';
        $channelId = $parts[1] ?? '';

        $camera = $this->getOrBuildLocalCamera($streamId, $channelId);
        if ($camera->cameraId == null) {
            $camera->save();
        }

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

        $this->deleteTestVideoFile($camera);

        $dir = rtrim($this->getConfig()->getSetting('LIBRARY_LOCATION'), '/') . '/camera_test/';
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        $filename = $camera->cameraId . '_' . time() . '.' . $ext;
        move_uploaded_file($_FILES['file']['tmp_name'], $dir . $filename);

        $camera->testVideoFile = $filename;
        $camera->save();

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

        $camera = $this->cameraFactory->getByChannelId($channelId);
        if ($camera === null || empty($camera->testVideoFile)) {
            throw new NotFoundException(__('테스트 영상을 찾을 수 없습니다.'));
        }

        $path = rtrim($this->getConfig()->getSetting('LIBRARY_LOCATION'), '/') . '/camera_test/' . $camera->testVideoFile;
        if (!file_exists($path)) {
            throw new NotFoundException(__('테스트 영상을 찾을 수 없습니다.'));
        }

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

        $camera = $this->cameraFactory->getByChannelId($channelId);
        if ($camera !== null) {
            $this->deleteTestVideoFile($camera);
            $camera->testVideoFile = null;
            $camera->save();
        }

        $this->getState()->hydrate([
            'message' => __('테스트 영상이 삭제되었습니다.'),
            'success' => true,
        ]);

        return $this->render($request, $response);
    }

    private function deleteTestVideoFile(CameraEntity $camera): void
    {
        if (empty($camera->testVideoFile)) {
            return;
        }

        $path = rtrim($this->getConfig()->getSetting('LIBRARY_LOCATION'), '/') . '/camera_test/' . $camera->testVideoFile;
        if (file_exists($path)) {
            unlink($path);
        }
    }

    private function uuidv4() {
        $data = random_bytes(16);
        $data[6] = chr((ord($data[6]) & 0x0f) | 0x40); // 버전 4
        $data[8] = chr((ord($data[8]) & 0x3f) | 0x80); // 변형
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
    }
}
