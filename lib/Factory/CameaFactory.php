<?php
namespace Xibo\Factory;

class CameraFactory extends BaseFactory
{
    public function __construct(
        $user,
        $userFactory
    ) {
        // BaseFactory 메서드
        $this->setAclDependencies($user, $userFactory);
    }

    public function 
}