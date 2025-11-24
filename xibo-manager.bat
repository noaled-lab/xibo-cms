@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: ============================================
:: Xibo CMS 관리 도구
:: ============================================
title Xibo CMS 관리 도구

:menu
cls
echo.
echo ============================================
echo   Xibo CMS 관리 도구
echo ============================================
echo.
echo 1. 서비스 시작
echo 2. 서비스 중지
echo 3. 서비스 재시작
echo 4. 서비스 상태 확인
echo 5. 로그 보기
echo 6. 브라우저 열기
echo 7. 종료
echo.
set /p choice=선택하세요 (1-7): 

if "%choice%"=="1" goto start
if "%choice%"=="2" goto stop
if "%choice%"=="3" goto restart
if "%choice%"=="4" goto status
if "%choice%"=="5" goto logs
if "%choice%"=="6" goto browser
if "%choice%"=="7" goto end
goto menu

:start
cls
echo.
echo 서비스를 시작합니다...
docker-compose up -d
if errorlevel 1 (
    echo [오류] 서비스 시작에 실패했습니다.
    pause
) else (
    echo [성공] 서비스가 시작되었습니다.
    timeout /t 3 /nobreak >nul
    docker-compose ps
)
pause
goto menu

:stop
cls
echo.
echo 서비스를 중지합니다...
docker-compose down
if errorlevel 1 (
    echo [오류] 서비스 중지에 실패했습니다.
    pause
) else (
    echo [성공] 서비스가 중지되었습니다.
)
pause
goto menu

:restart
cls
echo.
echo 서비스를 재시작합니다...
docker-compose restart
if errorlevel 1 (
    echo [오류] 서비스 재시작에 실패했습니다.
    pause
) else (
    echo [성공] 서비스가 재시작되었습니다.
    timeout /t 3 /nobreak >nul
    docker-compose ps
)
pause
goto menu

:status
cls
echo.
echo 서비스 상태:
docker-compose ps
echo.
pause
goto menu

:logs
cls
echo.
echo 로그를 확인합니다. (종료: Ctrl+C)
timeout /t 2 /nobreak >nul
docker-compose logs -f
goto menu

:browser
start http://localhost:8000
echo 브라우저를 열었습니다.
timeout /t 2 /nobreak >nul
goto menu

:end
cls
echo.
echo 프로그램을 종료합니다.
timeout /t 1 /nobreak >nul
exit

