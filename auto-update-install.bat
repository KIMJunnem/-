@echo off
chcp 65001 >nul
rem 자동 업데이트 설치(9/25 준희 승인 "A"). relay-desk-site 폴더에 두고 두 번 눌러 한 번만 실행한다.
rem 설치 후: 5분마다 GitHub relay-desk 브랜치를 확인해, 새 수정이 있으면 받아서 전체 시험 통과 시에만 적용하고 서버를 재시작한다.
rem 시험에 실패하거나 이 PC에서 따로 고친 파일과 겹치면 적용하지 않는다. 끄려면 auto-update-uninstall.bat.
cd /d "%~dp0"
where git >nul 2>nul || (echo git을 찾지 못했습니다. 아무것도 바뀌지 않았습니다. & pause & exit /b 1)
where node >nul 2>nul || (echo node를 찾지 못했습니다. 아무것도 바뀌지 않았습니다. & pause & exit /b 1)
if not exist "server\relay-server.js" (echo 이 파일을 relay-desk-site 폴더 안에 두고 실행하세요. 아무것도 바뀌지 않았습니다. & pause & exit /b 1)

echo [1/3] GitHub 연결 확인 중... (로그인 창이 뜨면 GitHub에 로그인하세요. 이번 한 번만 필요합니다)
git fetch --no-tags https://github.com/KIMJunnem/-.git +relay-desk:refs/relay-auto-update/relay-desk || (echo GitHub에서 받지 못했습니다. 아무것도 바뀌지 않았습니다. & pause & exit /b 1)
if not exist scripts mkdir scripts
git show refs/relay-auto-update/relay-desk:scripts/auto-update.cjs > "scripts\auto-update.cjs.new" || (del /q "scripts\auto-update.cjs.new" 2>nul & echo 파일을 꺼내지 못했습니다. 아무것도 바뀌지 않았습니다. & pause & exit /b 1)
move /y "scripts\auto-update.cjs.new" "scripts\auto-update.cjs" >nul

echo [2/3] 첫 업데이트 적용 중(존댓말 필수 포함). 전체 시험 때문에 몇 분 걸립니다...
node scripts\auto-update.cjs --install
echo.
echo ---- 결과 ----
type "backups\auto-update\log.txt"
echo --------------

echo [3/3] 5분마다 자동 확인 등록 중...
> "%~dp0auto-update-run.bat" echo @echo off
>> "%~dp0auto-update-run.bat" echo cd /d "%%~dp0"
>> "%~dp0auto-update-run.bat" echo node scripts\auto-update.cjs
> "%~dp0auto-update-run.vbs" echo CreateObject("WScript.Shell").Run """" ^& Replace(WScript.ScriptFullName, ".vbs", ".bat") ^& """", 0, False
schtasks /create /tn "RelayDeskAutoUpdate" /sc minute /mo 5 /tr "wscript.exe \"%~dp0auto-update-run.vbs\"" /f >nul || (echo 자동 확인 등록에 실패했습니다. 이 화면을 캡처해서 보내 주세요. & pause & exit /b 1)
echo.
echo 설치 완료. 이제 5분마다 조용히 확인합니다(창이 뜨지 않음).
echo 기록 보기: backups\auto-update\log.txt   끄기: auto-update-uninstall.bat
pause
