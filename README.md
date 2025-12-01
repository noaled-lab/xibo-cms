### 데이터베이스 마이그레이션
```bash
docker compose exec dev-cms-web bash -c "cd /var/www/cms && php vendor/bin/phinx migrate"
```