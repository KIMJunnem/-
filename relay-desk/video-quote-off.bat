@echo off
chcp 65001 >nul
rem 영상 편집 자동 견적 끄기 (decisions 7-10, 지시 24). 감독 또는 준희가 직접 실행한다.
cd /d "%~dp0"
where node >nul 2>nul || (echo node를 찾지 못했습니다. & pause & exit /b 1)
node scripts\video-quote-switch.cjs off || (echo 설정 바꾸기 실패 - 아무것도 바뀌지 않았습니다. & pause & exit /b 1)
echo 서버 재시작 중...
curl -s -X POST -H "x-relay-admin: restart" -H "content-type: application/json" -d "{}" http://127.0.0.1:8787/api/admin/restart
echo.
echo 다음: 영상 편집 요청은 다시 준희 확인(수동)으로 돌아갑니다.
pause
