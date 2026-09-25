@echo off
chcp 65001 >nul
rem 제브 문지기(지시 31) 켜기. 준희가 직접 실행한다.
cd /d "%~dp0"
where node >nul 2>nul || (echo node를 찾지 못했습니다. & pause & exit /b 1)
node scripts\jev-gate-switch.cjs on || (echo 설정 바꾸기 실패 - 아무것도 바뀌지 않았습니다. & pause & exit /b 1)
echo 서버 재시작 중...
curl -s -X POST -H "x-relay-admin: restart" -H "content-type: application/json" -d "{}" http://127.0.0.1:8787/api/admin/restart
echo.
echo 다음: 규칙이 못 정한 고객 말만 제브가 먼저 봅니다(확률 0.9 이상만). 끄려면 jev-gate-off.bat.
pause
