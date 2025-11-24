@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: ============================================
:: Xibo CMS 자동 설치 및 실행 스크립트
:: ============================================
title Xibo CMS 설치 및 실행 도구

echo.
echo ============================================
echo   Xibo CMS 자동 설치 및 실행 도구
echo ============================================
echo.

:: 현재 디렉토리 확인
set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"

:: 로그 파일 설정
set "LOG_FILE=%PROJECT_DIR%xibo-setup.log"
echo [%date% %time%] 설치 시작 >> "%LOG_FILE%"

:: 1단계: Docker 확인
echo [1/6] Docker 설치 확인 중...
docker --version >nul 2>&1
if errorlevel 1 (
    echo [오류] Docker가 설치되어 있지 않습니다.
    echo Docker Desktop을 설치해주세요: https://www.docker.com/products/docker-desktop
    echo.
    pause
    exit /b 1
)
echo [성공] Docker가 설치되어 있습니다.
docker --version

:: Docker 서비스 실행 확인
docker ps >nul 2>&1
if errorlevel 1 (
    echo [경고] Docker 서비스가 실행되지 않았습니다. Docker Desktop을 실행해주세요.
    echo.
    pause
    exit /b 1
)
echo [성공] Docker 서비스가 실행 중입니다.
echo.

:: 2단계: 필수 폴더 확인 및 생성
echo [2/6] 필수 폴더 확인 및 생성 중...
if not exist "cache" mkdir cache
if not exist "library" mkdir library
if not exist "vendor" mkdir vendor
echo [성공] 필수 폴더가 준비되었습니다.
echo.

:: 3단계: PHP 의존성 설치 확인
echo [3/6] PHP 의존성 확인 중...
if not exist "vendor\autoload.php" (
    echo [설치 중] Composer를 사용하여 PHP 의존성을 설치합니다...
    echo 이 작업은 시간이 걸릴 수 있습니다...
    docker run --rm --interactive --tty --volume "%PROJECT_DIR%:/app" --volume "%USERPROFILE%\.composer:/tmp" composer install
    if errorlevel 1 (
        echo [오류] PHP 의존성 설치에 실패했습니다.
        pause
        exit /b 1
    )
    echo [성공] PHP 의존성 설치 완료.
) else (
    echo [건너뜀] PHP 의존성이 이미 설치되어 있습니다.
)
echo.

:: 4단계: Node.js 의존성 확인
echo [4/6] Node.js 의존성 확인 중...
if not exist "node_modules" (
    echo [설치 중] npm을 사용하여 Node.js 의존성을 설치합니다...
    echo 이 작업은 시간이 걸릴 수 있습니다...
    docker run --rm -it --volume "%PROJECT_DIR%:/app" --volume "%USERPROFILE%\.npm:/root/.npm" -w /app node:22 sh -c "npm install"
    if errorlevel 1 (
        echo [오류] Node.js 의존성 설치에 실패했습니다.
        pause
        exit /b 1
    )
    echo [성공] Node.js 의존성 설치 완료.
) else (
    echo [건너뜀] Node.js 의존성이 이미 설치되어 있습니다.
)
echo.

:: 5단계: Webpack 빌드 확인
echo [5/6] Webpack 빌드 확인 중...
if not exist "web\dist" (
    echo [빌드 중] Webpack으로 프로젝트를 빌드합니다...
    echo 이 작업은 시간이 걸릴 수 있습니다...
    docker run --rm -it --volume "%PROJECT_DIR%:/app" --volume "%USERPROFILE%\.npm:/root/.npm" -w /app node:22 sh -c "npm run build"
    if errorlevel 1 (
        echo [오류] Webpack 빌드에 실패했습니다.
        pause
        exit /b 1
    )
    echo [성공] Webpack 빌드 완료.
) else (
    echo [건너뜀] 빌드된 파일이 이미 존재합니다.
)
echo.

:: 6단계: Docker Compose 실행
echo [6/6] Docker Compose로 서비스 시작 중...
echo.
docker-compose down
docker-compose up --build -d
if errorlevel 1 (
    echo [오류] Docker Compose 실행에 실패했습니다.
    pause
    exit /b 1
)
echo.
echo [성공] 모든 서비스가 시작되었습니다!
echo.

:: 서비스 상태 확인
echo 서비스 상태 확인 중...
timeout /t 5 /nobreak >nul
docker-compose ps
echo.

:: 완료 메시지
echo ============================================
echo   설치 완료!
echo ============================================
echo.
echo 접속 주소:
echo   - 메인 CMS: http://localhost:8000
echo   - API 문서: http://localhost:8080
echo.
echo 기본 로그인 정보:
echo   - 사용자명: xibo_admin
echo   - 비밀번호: password
echo.
echo 서비스 관리:
echo   - 시작: docker-compose up -d
echo   - 중지: docker-compose down
echo   - 재시작: docker-compose restart
echo   - 로그 확인: docker-compose logs -f
echo.
echo 브라우저를 열까요? (Y/N)
set /p OPEN_BROWSER=

if /i "%OPEN_BROWSER%"=="Y" (
    start http://localhost:8000
)

echo.
echo [%date% %time%] 설치 완료 >> "%LOG_FILE%"
echo.
pause

