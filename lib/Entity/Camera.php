<?php

namespace Xibo\Entity;

class Camera implements \JsonSerializable
{
    // 공통 엔티티 특성 사용
    use EntityTrait;

    public $name; // 채널 이름
    public $streamId; // 스트림 아이디 (yangsan으로 고정)
    public $channelId; // 채널 아이디
    public $url; // RTSP 스트림 URL

    public function __construct($store, $log, $dispatcher) {
        $this->setCommonDependencies($store, $log, $dispatcher);
    }

    // 저장
    public function save() {

    }

    // 추가
    private function add() {

    }

    // 수정
    private function edit() {

    }

    // 삭제
    public function delete() {

    }
}