@echo off
chcp 65001 >nul
rem 고객 첨부 판단(Claude) 끄기 (decisions 7-7, 지시 20). 감독이 실행한다.
cd /d "%~dp0"
where node >nul 2>nul || (echo node를 찾지 못했습니다. & pause & exit /b 1)
node scripts\attachment-judge-switch.cjs off || (echo 설정 바꾸기 실패 - 아무것도 바뀌지 않았습니다. & pause & exit /b 1)
echo 서버 재시작 중...
curl -s -X POST -H "x-relay-admin: restart" -H "content-type: application/json" -d "{}" http://127.0.0.1:8787/api/admin/restart
echo.
echo 다음: 고객 첨부 판단을 끕니다. 첨부는 예전처럼 알림만(attachmentRead 설정대로).
pause
