@echo off
chcp 65001 >nul
rem 자동 업데이트 끄기. 이미 적용된 수정은 그대로 둔다.
cd /d "%~dp0"
schtasks /delete /tn "RelayDeskAutoUpdate" /f
echo 자동 업데이트를 껐습니다. 다시 켜려면 auto-update-install.bat.
pause
