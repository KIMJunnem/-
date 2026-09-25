@echo off
chcp 65001 >nul
rem 고객 말 정해진 문구 답장 끄기(Claude가 답함, 지시 30 기본) (개발방 지시 30). 감독 또는 준희가 직접 실행한다.
cd /d "%~dp0"
where node >nul 2>nul || (echo node를 찾지 못했습니다. & pause & exit /b 1)
node scripts\chat-template-switch.cjs off || (echo 설정 바꾸기 실패 - 아무것도 바뀌지 않았습니다. & pause & exit /b 1)
echo 서버 재시작 중...
curl -s -X POST -H "x-relay-admin: restart" -H "content-type: application/json" -d "{}" http://127.0.0.1:8787/api/admin/restart
echo.
echo 다음: 고객이 직접 쓴 말은 Claude가 답합니다(하루 40건·월 15,000원 한도). 예전 방식은 chat-template-on.bat.
pause
