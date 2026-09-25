@echo off
chcp 65001 >nul
rem 고객 첨부 판단(Claude) 켜기 (decisions 7-7, 지시 20). 감독이 실행한다.
cd /d "%~dp0"
where node >nul 2>nul || (echo node를 찾지 못했습니다. & pause & exit /b 1)
node scripts\attachment-judge-switch.cjs on || (echo 설정 바꾸기 실패 - 아무것도 바뀌지 않았습니다. & pause & exit /b 1)
echo 서버 재시작 중...
curl -s -X POST -H "x-relay-admin: restart" -H "content-type: application/json" -d "{}" http://127.0.0.1:8787/api/admin/restart
echo.
echo 다음: 고객이 보낸 사진·PDF·문서·영상·링크를 판단합니다(영상은 PC에서 길이만, 채팅봇 비용 상한에 합쳐 셈). 끄려면 attachment-judge-off.bat.
pause
