@echo off
chcp 65001 >nul
rem 숨고 문서·교정 자동 견적 끄기 (decisions 7-13, 지시 27). 감독 또는 준희가 직접 실행한다.
cd /d "%~dp0"
where node >nul 2>nul || (echo node를 찾지 못했습니다. & pause & exit /b 1)
node scripts\soomgo-quote-switch.cjs doc off || (echo 설정 바꾸기 실패 - 아무것도 바뀌지 않았습니다. & pause & exit /b 1)
echo 서버 재시작 중...
curl -s -X POST -H "x-relay-admin: restart" -H "content-type: application/json" -d "{}" http://127.0.0.1:8787/api/admin/restart
echo.
echo 다음: 숨고 문서·교정 요청에는 견적을 보내지 않고 삭제도 하지 않습니다(하루 요약에 건수만). 켜려면 doc-quote-on.bat.
pause
