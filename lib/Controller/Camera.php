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

    public function __construct()
    {
        $host = getenv('MEDIAMTX_API_HOST') ?: 'mediamtx:9997';
        $this->apiBaseUrl = sprintf('http://%s/v3/config/paths', $host);
    }

    // 기본 페이지
    public function displayPage(Request $request, Response $response) {
        $this->getState()->template = 'camera-page';
        return $this->render($request, $response);
    }

    public function search(Request $request, Response $response) {
        $cameras = [];

        try {
            $apiUrl = $this->apiBaseUrl . '/list';

            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $apiUrl);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_TIMEOUT, 10);

            $result = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($httpCode === 200 && $result) {
                $data = json_decode($result, true);

                if ($data && isset($data['items']) && is_array($data['items'])) {
                    foreach ($data['items'] as $item) {
                        if (in_array($item['name'], ['all_others', 'all_publishers', 'all_readers'])) {
                            continue;
                        }

                        $decoded = $this->decodeName($item['name'], $item['sourceFingerprint'] ?? '');

                        $cameras[] = [
                            'name' => $decoded['name'],
                            'channelId' => $item['name'],
                            'url' => '',
                            'rtspUrl' => $item['source'] ?? '',
                            'streamName' => $item['name'],
                            'onDemand' => $item['sourceOnDemand'] ?? false,
                            'status' => 0,
                            'type' => $decoded['type'],
                            'fisheyeParams' => $decoded['fisheyeParams'],
                            'hasTestVideo' => false,
                        ];
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
    private const XIBO_META_MARKER = "XIBO_META:";

    private function decodeName(?string $rawName, ?string $fingerprint = ''): array
    {
        $raw = (string) $rawName;
        $meta = (string) $fingerprint;

        if (str_starts_with($meta, self::XIBO_META_MARKER)) {
            $decoded = json_decode(substr($meta, strlen(self::XIBO_META_MARKER)), true);

            if (is_array($decoded)) {
                return [
                    'name' => (string) ($decoded['n'] ?? $raw),
                    'type' => ($decoded['t'] ?? '') === self::TYPE_FISHEYE ? self::TYPE_FISHEYE : self::TYPE_STANDARD,
                    'fisheyeParams' => ($decoded['t'] ?? '') === self::TYPE_FISHEYE 
                        ? array_merge($this->defaultFisheyeParams(), is_array($decoded['f'] ?? null) ? $decoded['f'] : []) 
                        : null,
                ];
            }
        }

        return [
            'name' => $raw,
            'type' => self::TYPE_STANDARD,
            'fisheyeParams' => null,
        ];
    }

    private function encodeFingerprint(string $displayName, string $type, ?array $fisheyeParams): string
    {
        return self::XIBO_META_MARKER . json_encode([
            'n' => $displayName,
            't' => $type,
            'f' => $fisheyeParams
        ]);
    }

    private function defaultFisheyeParams(): array
    {
        return [
            'cx' => 50, 'cy' => 50, 'cx2' => 50, 'cy2' => 50, 'rad' => 98, 'rin' => 0.25, 'rout' => 1.0,
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

        $cx = min(100, max(0, $sanitizedParams->getDouble('centerX')));
        $cy = min(100, max(0, $sanitizedParams->getDouble('centerY')));
        
        $hasCx2 = $sanitizedParams->hasParam('centerX2') && $sanitizedParams->getString('centerX2') !== '';
        $cx2 = $hasCx2 ? min(100, max(0, $sanitizedParams->getDouble('centerX2'))) : $cx;
        
        $hasCy2 = $sanitizedParams->hasParam('centerY2') && $sanitizedParams->getString('centerY2') !== '';
        $cy2 = $hasCy2 ? min(100, max(0, $sanitizedParams->getDouble('centerY2'))) : $cy;

        return [
            'cx' => $cx,
            'cy' => $cy,
            'cx2' => $cx2,
            'cy2' => $cy2,
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
    private function fetchChannel(string $channelId): ?array
    {
        try {
            $apiUrl = $this->apiBaseUrl . '/get/' . urlencode($channelId);
            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $apiUrl);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_TIMEOUT, 10);

            $result = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($httpCode === 200 && $result) {
                $channel = json_decode($result, true);
                if ($channel && isset($channel['name'])) {
                    $decoded = $this->decodeName($channel['name'], $channel['sourceFingerprint'] ?? '');

                    return [
                        'channelId' => $channel['name'],
                        'name' => $decoded['name'],
                        'type' => $decoded['type'],
                        'fisheyeParams' => $decoded['fisheyeParams'],
                        'url' => $channel['source'] ?? '',
                        'onDemand' => $channel['sourceOnDemand'] ?? false
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

        $channelId = preg_replace('/[^a-zA-Z0-9_-]/', '_', $sanitizedParams->getString('channelId') ?: 'ch' . substr(md5(microtime()), 0, 6));
        $name = $sanitizedParams->getString('name');
        $url = $sanitizedParams->getString('url');
        $onDemand = $sanitizedParams->getInt('onDemand') === 1;
        $type = $sanitizedParams->getString('type') ?: self::TYPE_STANDARD;

        $fingerprint = $this->encodeFingerprint(
            $name,
            $type,
            $type === self::TYPE_FISHEYE ? $this->defaultFisheyeParams() : null
        );

        try {
            $apiUrl = $this->apiBaseUrl . '/add/' . urlencode($channelId);

            $postData = json_encode([
                'source' => $url,
                'sourceOnDemand' => $onDemand,
                'sourceFingerprint' => $fingerprint
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

            if ($httpCode === 200) {
                $this->getState()->hydrate([
                    'message' => __('카메라가 추가되었습니다.'),
                    'id' => $channelId,
                    'success' => true
                ]);
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
        $channelId = str_contains($id, ':') ? explode(':', $id)[1] : $id;

        $channel = $this->fetchChannel($channelId) ?? [
            'channelId' => $channelId,
            'name' => '',
            'url' => '',
            'onDemand' => false,
            'type' => self::TYPE_STANDARD,
            'fisheyeParams' => null,
        ];
        $channel['id'] = $channelId;
        $channel['testVideoFile'] = null;

        $this->getState()->template = 'camera-form-edit';
        $this->getState()->setData([
            'camera' => $channel,
            'fisheyeParams' => $channel['fisheyeParams'] ?? $this->defaultFisheyeParams(),
        ]);

        return $this->render($request, $response);
    }

    // 채널 수정 처리
    public function edit(Request $request, Response $response, $id) {
        $channelId = str_contains($id, ':') ? explode(':', $id)[1] : $id;

        $sanitizedParams = $this->getSanitizer($request->getParams());
        $name = $sanitizedParams->getString('name');
        $url = $sanitizedParams->getString('url');
        $onDemand = $sanitizedParams->getInt('onDemand') === 1;
        $type = $sanitizedParams->getString('type') ?: self::TYPE_STANDARD;

        $fisheyeParams = $type === self::TYPE_FISHEYE ? $this->buildFisheyeParamsFromRequest($sanitizedParams) : null;
        $fingerprint = $this->encodeFingerprint($name, $type, $fisheyeParams);

        try {
            $apiUrl = $this->apiBaseUrl . '/patch/' . urlencode($channelId);

            $postData = json_encode([
                'source' => $url,
                'sourceOnDemand' => $onDemand,
                'sourceFingerprint' => $fingerprint
            ]);

            $this->getLog()->debug('Camera edit request - URL: ' . $apiUrl . ', Data: ' . $postData);

            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $apiUrl);
            curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'PATCH');
            curl_setopt($ch, CURLOPT_POSTFIELDS, $postData);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
            curl_setopt($ch, CURLOPT_TIMEOUT, 10);

            $result = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $curlError = curl_error($ch);
            
            // if PATCH fails with 404/405, fallback to edit POST
            if ($httpCode >= 400 && $httpCode < 500) {
                $apiUrl = $this->apiBaseUrl . '/edit/' . urlencode($channelId);
                curl_setopt($ch, CURLOPT_URL, $apiUrl);
                curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'POST');
                $result = curl_exec($ch);
                $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
                $curlError = curl_error($ch);
            }
            curl_close($ch);

            $this->getLog()->debug('Camera edit response - HTTP Code: ' . $httpCode . ', Result: ' . $result . ', cURL Error: ' . $curlError);

            if ($httpCode === 200) {
                $this->getState()->hydrate([
                    'message' => __('카메라가 수정되었습니다.'),
                    'id' => $id,
                    'success' => true
                ]);
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
        $channelId = str_contains($id, ':') ? explode(':', $id)[1] : $id;

        $camera = [
            'channelId' => $channelId,
            'name' => $channelId
        ];

        $this->getState()->template = 'camera-form-delete';
        $this->getState()->setData(['camera' => $camera]);

        return $this->render($request, $response);
    }

    // 채널 삭제 처리
    public function delete(Request $request, Response $response, $id) {
        $channelId = str_contains($id, ':') ? explode(':', $id)[1] : $id;

        try {
            $apiUrl = $this->apiBaseUrl . '/delete/' . urlencode($channelId);

            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $apiUrl);
            curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'DELETE');
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_TIMEOUT, 10);

            $result = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($httpCode === 200) {
                $this->getState()->hydrate([
                    'message' => __('카메라가 삭제되었습니다.'),
                    'id' => $id,
                    'success' => true
                ]);
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
        $channelId = str_contains($id, ':') ? explode(':', $id)[1] : $id;

        $channel = $this->fetchChannel($channelId) ?? [
            'channelId' => $channelId,
            'name' => $channelId,
            'url' => '',
            'onDemand' => false,
            'type' => self::TYPE_STANDARD,
            'fisheyeParams' => null,
        ];
        $channel['id'] = $id;
        $channel['testVideoFile'] = null;

        $this->getState()->template = 'camera-detail';
        $this->getState()->setData([
            'camera' => $channel,
            'fisheyeParams' => $channel['type'] === self::TYPE_FISHEYE ? $channel['fisheyeParams'] : null,
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
