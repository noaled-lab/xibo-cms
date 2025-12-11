<?php
namespace Xibo\Controller;

use Slim\Http\Response as Response;
use Slim\Http\ServerRequest as Request;

class Camera extends Base
{
    private $apiBaseUrl;

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
                                $cameras[] = [
                                    'name' => $channel['name'] ?? '',
                                    'streamId' => $streamId,
                                    'channelId' => $channelId,
                                    'url' => $this->generateWebSocketUrl($streamId, $channelId),
                                    'rtspUrl' => $channel['url'] ?? '',
                                    'streamName' => $stream['name'] ?? '',
                                    'onDemand' => $channel['on_demand'] ?? false,
                                    'status' => $channel['status'] ?? 0
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
        // 브라우저에서 접근 가능한 주소 사용 (127.0.0.1 또는 실제 서버 IP)
        return "ws://127.0.0.1:8083/stream/{$streamId}/channel/{$channelId}/mse?uuid={$streamId}&channel={$channelId}";
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

        // API에서 현재 카메라 정보 가져오기
        $camera = null;
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
                    $camera = [
                        'streamId' => $streamId,
                        'channelId' => $channelId,
                        'name' => $channel['name'] ?? '',
                        'url' => $channel['url'] ?? '',
                        'onDemand' => $channel['on_demand'] ?? false
                    ];
                }
            }
        } catch (\Exception $e) {
            $this->getLog()->error('Failed to fetch camera for edit: ' . $e->getMessage());
        }

        if (!$camera) {
            $camera = [
                'streamId' => $streamId,
                'channelId' => $channelId,
                'name' => '',
                'url' => '',
                'onDemand' => false
            ];
        }

        $this->getState()->template = 'camera-form-edit';
        $this->getState()->setData(['camera' => $camera]);

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

    private function uuidv4() {
        $data = random_bytes(16);
        $data[6] = chr((ord($data[6]) & 0x0f) | 0x40); // 버전 4
        $data[8] = chr((ord($data[8]) & 0x3f) | 0x80); // 변형
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
    }
}
