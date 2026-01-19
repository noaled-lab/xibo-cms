<?php
/**
 * requiredfile 테이블에 bytesDownloaded 컬럼 추가
 *
 * Player가 MediaInventory를 통해 보고하는 실제 다운로드 진행 바이트 수를 추적하기 위한 컬럼
 * - bytesRequested: CMS가 GetFile을 통해 제공한 바이트 수 (bandwidth 추적)
 * - bytesDownloaded: Player가 실제로 다운로드한 바이트 수 (progress 추적)
 *
 * @phpcs:disable PSR1.Classes.ClassDeclaration.MissingNamespace
 */

use Phinx\Migration\AbstractMigration;

/**
 * Class AddBytesDownloadedColumnMigration
 */
class AddBytesDownloadedColumnMigration extends AbstractMigration
{
    /** @inheritDoc */
    public function change()
    {
        // bytesDownloaded 컬럼 추가 (double 타입, 기본값 0.0)
        $table = $this->table('requiredfile');
        $table
            ->addColumn('bytesDownloaded', 'double', [
                'default' => 0.0,
                'after' => 'bytesRequested'
            ])
            ->save();

        // 이미 완료된 파일들의 bytesDownloaded를 size로 설정
        // (마이그레이션 전에 완료된 파일들도 100% 진행률로 표시되도록)
        $this->execute('
            UPDATE `requiredfile`
            SET `bytesDownloaded` = `size`
            WHERE `complete` = 1
        ');
    }
}
