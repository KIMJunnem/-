@echo off
chcp 65001 >nul
rem 견적 판단(Claude) 켜기 (decisions 7-10, 지시 19). 감독이 실행한다.
cd /d "%~dp0"
where node >nul 2>nul || (echo node를 찾지 못했습니다. & pause & exit /b 1)
node scripts\quote-judge-switch.cjs on || (echo 설정 바꾸기 실패 - 아무것도 바뀌지 않았습니다. & pause & exit /b 1)
echo 서버 재시작 중...
curl -s -X POST -H "x-relay-admin: restart" -H "content-type: application/json" -d "{}" http://127.0.0.1:8787/api/admin/restart
echo.
echo 다음: 숨고 요청 중 규칙이 사람 확인으로 남긴 것을 Claude가 판단합니다(하루 호출 40회, 자동 발송 10건). 끄려면 quote-judge-off.bat.
pause
