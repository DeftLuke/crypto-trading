@echo off
:: Run this file as Administrator (right-click -> Run as administrator)
echo Stopping Windows cloudflared (duplicate connector causes 503)...
net stop cloudflared
sc config cloudflared start= disabled
"C:\Program Files (x86)\cloudflared\cloudflared.exe" service uninstall
echo.
echo Done. Only Kali server should run the tunnel now.
echo Test in browser:
echo   https://ai.deftluke.online/health
echo   https://n8n.deftluke.online/healthz
pause
