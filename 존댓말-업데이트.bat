@echo off
chcp 65001 >nul
rem 채팅봇 존댓말 필수(9/25) 업데이트. 준희가 relay-desk-site 폴더에 이 파일을 두고 두 번 눌러 실행한다.
rem 하는 일: GitHub에서 새 파일 3개 받기 -> 기존 파일 3개에 몇 줄 끼워 넣기(원본은 backups\honorific-update에 백업) -> 검사 -> 서버 재시작
rem 숨고 확장 프로그램은 바뀌지 않아서 다시 설치할 필요 없음.
cd /d "%~dp0"
where git >nul 2>nul || (echo git을 찾지 못했습니다. 아무것도 바뀌지 않았습니다. & pause & exit /b 1)
where node >nul 2>nul || (echo node를 찾지 못했습니다. 아무것도 바뀌지 않았습니다. & pause & exit /b 1)
if not exist "server\relay-server.js" (echo 이 파일을 relay-desk-site 폴더 안에 두고 실행하세요. 아무것도 바뀌지 않았습니다. & pause & exit /b 1)

echo [1/4] GitHub에서 새 파일 받는 중... (로그인 창이 뜨면 GitHub에 로그인하세요)
git fetch --no-tags https://github.com/KIMJunnem/-.git relay-desk || (echo GitHub에서 받지 못했습니다. 아무것도 바뀌지 않았습니다. & pause & exit /b 1)
git show FETCH_HEAD:server/honorific-guard.js > "server\honorific-guard.js.new" || goto :fetchfail
git show FETCH_HEAD:tests/honorific-guard.cjs > "tests\honorific-guard.cjs.new" || goto :fetchfail
git show FETCH_HEAD:scripts/apply-honorific-update.cjs > "scripts\apply-honorific-update.cjs.new" || goto :fetchfail
move /y "server\honorific-guard.js.new" "server\honorific-guard.js" >nul
move /y "tests\honorific-guard.cjs.new" "tests\honorific-guard.cjs" >nul
move /y "scripts\apply-honorific-update.cjs.new" "scripts\apply-honorific-update.cjs" >nul

echo [2/4] 기존 파일에 존댓말 검사 넣는 중...
node scripts\apply-honorific-update.cjs || (echo 넣을 자리를 못 찾아 기존 파일은 바꾸지 않았습니다. 이 화면을 캡처해서 보내 주세요. & pause & exit /b 1)

echo [3/4] 검사 중...
node --check server\relay-server.js || goto :checkfail
node tests\honorific-guard.cjs || goto :checkfail

echo [4/4] 서버 재시작 중...
curl -s -X POST -H "x-relay-admin: restart" -H "content-type: application/json" -d "{}" http://127.0.0.1:8787/api/admin/restart || echo 서버가 꺼져 있습니다. 평소처럼 서버를 켜면 새 버전으로 켜집니다.
echo.
echo 완료: 이제 채팅봇 답장에 반말 문장이 있으면 보내지 않고 사람 확인으로 넘깁니다.
pause
exit /b 0

:fetchfail
del /q "server\honorific-guard.js.new" "tests\honorific-guard.cjs.new" "scripts\apply-honorific-update.cjs.new" 2>nul
echo GitHub에서 파일을 꺼내지 못했습니다. 아무것도 바뀌지 않았습니다.
pause
exit /b 1

:checkfail
echo 검사에 실패했습니다. 서버는 재시작하지 않았으니 지금 돌아가는 봇은 예전 그대로입니다.
echo 원본은 backups\honorific-update 폴더에 있습니다. 이 화면을 캡처해서 보내 주세요.
pause
exit /b 1
