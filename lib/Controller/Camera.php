<?php
namespace Xibo\Controller;

use Slim\Http\Response as Response;
use Slim\Http\ServerRequest as Request;
use Xibo\Service\BaseDependenciesService;

class Camera extends Base
{
    // 기본 페이지
    public function displayPage(Request $request, Response $response)
    {
        $this->getState()->template = 'camera-page';

        return $this->render($request, $response);
    }

    // 채널 추가 폼

    // 채널 수정 폼

    // 채널 삭제 폼
}
