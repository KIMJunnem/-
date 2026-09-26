@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Relay Desk 쉬운 확인기

cd /d "%~dp0"

echo.
echo ============================================
echo   Relay Desk 쉬운 확인기
echo ============================================
echo.
echo 1. 최신 파일 확인
echo 2. 서버 상태 확인
echo 3. 무료 고객응대 시뮬레이션 실행
echo.

if not exist "server\relay-server.js" (
  echo [실패] 이 파일을 Relay Desk 폴더 안에서 실행해 주세요.
  echo.
  pause
  exit /b 1
)

echo [1/3] 최신 파일 확인 중...
if exist "scripts\auto-update.cjs" (
  node "scripts\auto-update.cjs"
) else (
  echo 자동업데이트 스크립트를 찾지 못했습니다.
)
echo.

set "ECC_OK=1"
if not exist "server\learning-ledger.js" set "ECC_OK=0"
findstr /C:"estimateComplexity" "server\model-router.js" >nul 2>&1 || set "ECC_OK=0"
findstr /C:"deliveryBinding" "server\astra-room-bridge.js" >nul 2>&1 || set "ECC_OK=0"

if "%ECC_OK%"=="1" (
  echo [OK] ECC 선별 기능 파일이 적용돼 있습니다.
) else (
  echo [주의] 아직 최신 ECC 기능이 전부 적용되지 않았습니다.
)
echo.

echo [2/3] Relay Desk 서버 확인 중...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try {" ^
  " $r=Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/customer-simulation' -TimeoutSec 5;" ^
  " Write-Host '[OK] Relay Desk 서버 연결됨' -ForegroundColor Green;" ^
  " if($null -ne $r.status.effectiveIntervalMinutes){" ^
  "   Write-Host '[OK] 최신 자율 시뮬레이션 기능 실행 중' -ForegroundColor Green;" ^
  "   Write-Host ('검사 간격: ' + $r.status.effectiveIntervalMinutes + '분');" ^
  "   Write-Host ('학습 후보: ' + $r.status.openLearningCandidates + '개');" ^
  "   if($r.latest){" ^
  "     Write-Host ('최근 pass@1: ' + [Math]::Round(([double]$r.latest.metrics.passAt1)*100,1) + '%%');" ^
  "     Write-Host ('하드 실패: ' + $r.latest.hardFailureCount + '건');" ^
  "   }" ^
  "   exit 0" ^
  " }" ^
  " Write-Host '[주의] 서버는 켜져 있지만 최신 기능이 아직 반영되지 않았습니다.' -ForegroundColor Yellow;" ^
  " exit 3" ^
  "} catch {" ^
  " Write-Host '[주의] Relay Desk 서버가 꺼져 있습니다.' -ForegroundColor Yellow;" ^
  " exit 2" ^
  "}"
set "API_STATUS=%ERRORLEVEL%"
echo.

if "%API_STATUS%"=="2" (
  set /p STARTSERVER="서버를 지금 켤까요? (Y/N): "
  if /I "%STARTSERVER%"=="Y" (
    echo 서버를 새 창에서 시작합니다...
    start "Relay Desk Server" cmd /k "cd /d ""%CD%"" && npm start"
    timeout /t 6 /nobreak >nul
    echo.
  )
)

echo [3/3] 무료 고객응대 시뮬레이션
set /p RUNSIM="지금 1회 돌릴까요? 실제 고객에게는 전송되지 않습니다. (Y/N): "
if /I "%RUNSIM%"=="Y" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "try {" ^
    " $r=Invoke-RestMethod -Method POST -Uri 'http://127.0.0.1:8787/api/customer-simulation/run' -TimeoutSec 180;" ^
    " $x=$r.run;" ^
    " Write-Host '';" ^
    " Write-Host '========== 결과 ==========';" ^
    " Write-Host ('합성 고객: ' + $x.caseCount + '건');" ^
    " Write-Host ('pass@1: ' + [Math]::Round(([double]$x.metrics.passAt1)*100,1) + '%%');" ^
    " Write-Host ('하드 실패: ' + $x.hardFailureCount + '건');" ^
    " Write-Host ('새 학습 후보: ' + $x.newLearningCandidateCount + '개');" ^
    " Write-Host ('유료 모델 호출: ' + $x.paidModelCalls + '회');" ^
    " Write-Host ('자동 코드 수정: ' + $x.autoPatches + '회');" ^
    " Write-Host '==========================';" ^
    "} catch {" ^
    " Write-Host '[실패] 시뮬레이션을 실행하지 못했습니다.' -ForegroundColor Red;" ^
    " Write-Host $_.Exception.Message;" ^
    "}"
)

echo.
echo 끝났습니다.
echo 이 창을 사진 찍어서 보내주시면 됩니다.
echo.
pause
endlocal
