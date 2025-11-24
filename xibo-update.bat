@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: ============================================
:: Xibo CMS 업데이트 도구
:: ============================================
title Xibo CMS 업데이트 도구

echo.
echo ============================================
echo   Xibo CMS 업데이트 도구
echo ============================================
echo.
echo 이 도구는 원본 Xibo 저장소의 최신 변경사항을
echo 가져와서 NOA 커스터마이징과 병합합니다.
echo.

:: Git 설치 확인
git --version >nul 2>&1
if errorlevel 1 (
    echo [오류] Git이 설치되어 있지 않습니다.
    echo Git을 설치해주세요: https://git-scm.com/downloads
    echo.
    pause
    exit /b 1
)

:: 현재 디렉토리 확인
set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"

:: 현재 변경사항 확인
echo [1/5] 현재 변경사항 확인 중...
echo.wwwwwwwwwwww
git status --short
if errorlevel 1 (
    echo [오류] Git 저장소가 아닙니다.
    pause
    exit /b 1
)

echo.
set HAS_CHANGES=0
git diff --quiet
if errorlevel 1 (
    set HAS_CHANGES=1
    echo [경고] 수정된 파일이 있습니다.
)

git diff --cached --quiet
if errorlevel 1 (
    set HAS_CHANGES=1
    echo [경고] 스테이징된 파일이 있습니다.
)

if !HAS_CHANGES!==0 (
    git ls-files --others --exclude-standard | findstr /R "." >nul
    if not errorlevel 1 (
        set HAS_CHANGES=1
        echo [경고] 추적되지 않은 새 파일이 있습니다.
    )
)

if !HAS_CHANGES!==1 (
    echo.
    echo 변경된 파일 목록:
    git status --short
    echo.
    set /p BACKUP=변경사항을 백업하시겠습니까? (Y/N): 
    if /i "!BACKUP!"=="Y" (
        echo.
        echo 변경사항을 커밋합니다...
        git add .
        git commit -m "업데이트 전 NOA 커스터마이징 백업 - %date% %time%"
        if errorlevel 1 (
            echo [오류] 커밋에 실패했습니다.
            pause
            exit /b 1
        )
        echo [성공] 변경사항이 백업되었습니다.
    ) else (
        echo.
        set /p CONTINUE=변경사항을 백업하지 않고 계속하시겠습니까? (Y/N): 
        if /i not "!CONTINUE!"=="Y" (
            echo 업데이트가 취소되었습니다.
            pause
            exit /b 0
        )
    )
)

echo.
echo [2/5] 원본 저장소에서 최신 정보 가져오기...
git fetch origin
if errorlevel 1 (
    echo [오류] 원본 저장소에서 정보를 가져올 수 없습니다.
    echo 인터넷 연결을 확인해주세요.
    pause
    exit /b 1
)
echo [성공] 원본 저장소 정보를 가져왔습니다.

echo.
echo [3/5] 업데이트 내용 확인...
echo.
echo 최근 업데이트 내역:
git log HEAD..origin/develop --oneline --graph -10
if errorlevel 1 (
    echo [정보] 새로운 업데이트가 없습니다.
    echo.
    pause
    exit /b 0
)

echo.
echo 변경된 파일 목록:
git diff --name-only HEAD..origin/develop

echo.
echo.
set /p CONFIRM=위의 업데이트를 적용하시겠습니까? (Y/N): 
if /i not "!CONFIRM!"=="Y" (
    echo 업데이트가 취소되었습니다.
    pause
    exit /b 0
)

echo.
echo [4/5] 업데이트 적용 중...
echo 이것은 시간이 걸릴 수 있습니다...
echo.
git merge origin/develop

if errorlevel 1 (
    echo.
    echo [경고] 충돌이 발생했습니다!
    echo.
    echo 충돌 파일 목록:
    git diff --name-only --diff-filter=U
    echo.
    echo ============================================
    echo   충돌 해결 방법
    echo ============================================
    echo.
    echo 1. 충돌 파일을 열어서 확인
    echo 2. 충돌 마커를 찾아서 수정:
    echo    ^<<<<<<< HEAD
    echo    우리의 변경사항
    echo    =======
    echo    원본의 변경사항
    echo    ^>>>>>>> origin/develop
    echo.
    echo 3. 충돌 해결 후:
    echo    git add ^<파일명^>
    echo    git commit
    echo.
    echo 또는 우리 변경사항을 유지하려면:
    echo    git checkout --ours ^<파일명^>
    echo    git add ^<파일명^>
    echo    git commit
    echo.
    echo 브랜딩 파일 (noalogo.png 등)은 보통 우리 변경사항을 유지합니다.
    echo.
    pause
    exit /b 1
)

echo.
echo [5/5] 업데이트 완료 확인...
echo.
echo [성공] 업데이트가 완료되었습니다!
echo.
echo 변경된 파일:
git log HEAD@{1}..HEAD --name-only --pretty=format: --diff-filter=A
git log HEAD@{1}..HEAD --name-only --pretty=format: --diff-filter=M
echo.

:: 충돌 가능한 파일 확인
echo.
echo [정보] NOA 커스터마이징 파일 확인:
if exist "web\theme\default\img\noalogo.png" (
    echo [확인] NOA 로고 파일 존재
) else (
    echo [경고] NOA 로고 파일이 없습니다!
)

echo.
echo ============================================
echo   다음 단계
echo ============================================
echo.
echo 1. Docker 컨테이너 재시작 권장:
echo    docker-compose restart
echo.
echo 2. 웹사이트에서 정상 작동 확인:
echo    http://localhost:8000
echo.
echo 3. NOA 로고가 정상 표시되는지 확인
echo.

set /p RESTART=Docker 컨테이너를 재시작하시겠습니까? (Y/N): 
if /i "!RESTART!"=="Y" (
    echo.
    echo Docker 컨테이너 재시작 중...
    docker-compose restart
    if errorlevel 1 (
        echo [경고] Docker 재시작에 실패했습니다. 수동으로 재시작해주세요.
    ) else (
        echo [성공] Docker 컨테이너가 재시작되었습니다.
    )
)

echo.
pause

