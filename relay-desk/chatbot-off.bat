@echo off
chcp 65001 >nul
rem 채팅봇 끄기 (되돌리기). 준희가 직접 실행한다.
cd /d "%~dp0"
where node >nul 2>nul || (echo node를 찾지 못했습니다. & pause & exit /b 1)
node scripts\chatbot-switch.cjs off || (echo 설정 바꾸기 실패 - 아무것도 바뀌지 않았습니다. & pause & exit /b 1)
echo 서버 재시작 중...
curl -s -X POST -H "x-relay-admin: restart" -H "content-type: application/json" -d "{}" http://127.0.0.1:8787/api/admin/restart
echo.
echo 채팅봇 발송·Claude 답장이 꺼졌습니다. 패널도 OFF로 두세요.
pause
