<?php
/*
 * Minimal Camera controller
 */
namespace Xibo\Controller;

use Slim\Http\Response as Response;
use Slim\Http\ServerRequest as Request;
use Xibo\Service\BaseDependenciesService;

class Camera extends Base
{

    /**
     * Render an empty camera page placeholder
     */
    public function displayPage(Request $request, Response $response)
    {
        $this->getState()->template = 'camera-page';

        return $this->render($request, $response);
    }
}
