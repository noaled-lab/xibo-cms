# ============================================
# Xibo CMS 자동 설치 및 실행 스크립트 (PowerShell)
# ============================================
# 실행 방법: PowerShell에서 "Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser" 후 실행

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Step {
    param([string]$Message, [int]$Step, [int]$Total)
    Write-Host "[$Step/$Total] $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "[성공] $Message" -ForegroundColor Green
}

function Write-Error {
    param([string]$Message)
    Write-Host "[오류] $Message" -ForegroundColor Red
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[경고] $Message" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Xibo CMS 자동 설치 및 실행 도구" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

$projectDir = $PSScriptRoot
if (-not $projectDir) {
    $projectDir = Get-Location
}

# 로그 파일
$logFile = Join-Path $projectDir "xibo-setup.log"
"[$([DateTime]::Now)] 설치 시작" | Out-File -FilePath $logFile -Append

# 1단계: Docker 확인
Write-Step "Docker 설치 확인 중..." 1 6
try {
    $dockerVersion = docker --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Docker가 설치되어 있지 않습니다."
    }
    Write-Success "Docker가 설치되어 있습니다."
    Write-Host $dockerVersion
} catch {
    Write-Error "Docker가 설치되어 있지 않습니다."
    Write-Host "Docker Desktop을 설치해주세요: https://www.docker.com/products/docker-desktop"
    Read-Host "아무 키나 누르면 종료됩니다"
    exit 1
}

# Docker 서비스 확인
try {
    docker ps | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker 서비스가 실행되지 않았습니다."
    }
    Write-Success "Docker 서비스가 실행 중입니다."
} catch {
    Write-Warning "Docker 서비스가 실행되지 않았습니다. Docker Desktop을 실행해주세요."
    Read-Host "아무 키나 누르면 종료됩니다"
    exit 1
}
Write-Host ""

# 2단계: 필수 폴더 확인 및 생성
Write-Step "필수 폴더 확인 및 생성 중..." 2 6
$folders = @("cache", "library", "vendor")
foreach ($folder in $folders) {
    $folderPath = Join-Path $projectDir $folder
    if (-not (Test-Path $folderPath)) {
        New-Item -ItemType Directory -Path $folderPath -Force | Out-Null
        Write-Host "  - $folder 폴더 생성 완료"
    }
}
Write-Success "필수 폴더가 준비되었습니다."
Write-Host ""

# 3단계: PHP 의존성 설치 확인
Write-Step "PHP 의존성 확인 중..." 3 6
$vendorAutoload = Join-Path $projectDir "vendor\autoload.php"
if (-not (Test-Path $vendorAutoload)) {
    Write-Host "[설치 중] Composer를 사용하여 PHP 의존성을 설치합니다..."
    Write-Host "이 작업은 시간이 걸릴 수 있습니다..."
    
    $composerCache = Join-Path $env:USERPROFILE ".composer"
    docker run --rm --interactive --tty `
        --volume "${projectDir}:/app" `
        --volume "${composerCache}:/tmp" `
        composer install
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "PHP 의존성 설치에 실패했습니다."
        Read-Host "아무 키나 누르면 종료됩니다"
        exit 1
    }
    Write-Success "PHP 의존성 설치 완료."
} else {
    Write-Host "[건너뜀] PHP 의존성이 이미 설치되어 있습니다."
}
Write-Host ""

# 4단계: Node.js 의존성 확인
Write-Step "Node.js 의존성 확인 중..." 4 6
$nodeModules = Join-Path $projectDir "node_modules"
if (-not (Test-Path $nodeModules)) {
    Write-Host "[설치 중] npm을 사용하여 Node.js 의존성을 설치합니다..."
    Write-Host "이 작업은 시간이 걸릴 수 있습니다..."
    
    $npmCache = Join-Path $env:USERPROFILE ".npm"
    docker run --rm -it `
        --volume "${projectDir}:/app" `
        --volume "${npmCache}:/root/.npm" `
        -w /app node:22 sh -c "npm install"
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Node.js 의존성 설치에 실패했습니다."
        Read-Host "아무 키나 누르면 종료됩니다"
        exit 1
    }
    Write-Success "Node.js 의존성 설치 완료."
} else {
    Write-Host "[건너뜀] Node.js 의존성이 이미 설치되어 있습니다."
}
Write-Host ""

# 5단계: Webpack 빌드 확인
Write-Step "Webpack 빌드 확인 중..." 5 6
$webDist = Join-Path $projectDir "web\dist"
if (-not (Test-Path $webDist)) {
    Write-Host "[빌드 중] Webpack으로 프로젝트를 빌드합니다..."
    Write-Host "이 작업은 시간이 걸릴 수 있습니다..."
    
    $npmCache = Join-Path $env:USERPROFILE ".npm"
    docker run --rm -it `
        --volume "${projectDir}:/app" `
        --volume "${npmCache}:/root/.npm" `
        -w /app node:22 sh -c "npm run build"
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Webpack 빌드에 실패했습니다."
        Read-Host "아무 키나 누르면 종료됩니다"
        exit 1
    }
    Write-Success "Webpack 빌드 완료."
} else {
    Write-Host "[건너뜀] 빌드된 파일이 이미 존재합니다."
}
Write-Host ""

# 6단계: Docker Compose 실행
Write-Step "Docker Compose로 서비스 시작 중..." 6 6
docker-compose down
docker-compose up --build -d

if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker Compose 실행에 실패했습니다."
    Read-Host "아무 키나 누르면 종료됩니다"
    exit 1
}
Write-Host ""

# 서비스 상태 확인
Write-Host "서비스 상태 확인 중..."
Start-Sleep -Seconds 5
docker-compose ps
Write-Host ""

# 완료 메시지
Write-Host "============================================" -ForegroundColor Green
Write-Host "  설치 완료!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "접속 주소:" -ForegroundColor Yellow
Write-Host "  - 메인 CMS: http://localhost:8000" -ForegroundColor White
Write-Host "  - API 문서: http://localhost:8080" -ForegroundColor White
Write-Host ""
Write-Host "기본 로그인 정보:" -ForegroundColor Yellow
Write-Host "  - 사용자명: xibo_admin" -ForegroundColor White
Write-Host "  - 비밀번호: password" -ForegroundColor White
Write-Host ""
Write-Host "서비스 관리:" -ForegroundColor Yellow
Write-Host "  - 시작: docker-compose up -d" -ForegroundColor White
Write-Host "  - 중지: docker-compose down" -ForegroundColor White
Write-Host "  - 재시작: docker-compose restart" -ForegroundColor White
Write-Host "  - 로그 확인: docker-compose logs -f" -ForegroundColor White
Write-Host ""

$openBrowser = Read-Host "브라우저를 열까요? (Y/N)"
if ($openBrowser -eq "Y" -or $openBrowser -eq "y") {
    Start-Process "http://localhost:8000"
}

"[$([DateTime]::Now)] 설치 완료" | Out-File -FilePath $logFile -Append
Write-Host ""
Read-Host "아무 키나 누르면 종료됩니다"

