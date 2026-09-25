@echo off
chcp 65001 >nul
rem 채팅봇 켜기 (decisions 7-5). 준희가 직접 실행한다.
cd /d "%~dp0"
where node >nul 2>nul || (echo node를 찾지 못했습니다. & pause & exit /b 1)
node scripts\chatbot-switch.cjs on || (echo 설정 바꾸기 실패 - 아무것도 바뀌지 않았습니다. & pause & exit /b 1)
echo 서버 재시작 중...
curl -s -X POST -H "x-relay-admin: restart" -H "content-type: application/json" -d "{}" http://127.0.0.1:8787/api/admin/restart
echo.
echo 다음: 숨고 채팅 화면 오른쪽 아래 Relay Desk 패널을 OFF에서 ON으로 누르세요.
pause
