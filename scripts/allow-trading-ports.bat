@echo off
:: Allow Kali tunnel to reach backend (3001) and dashboard (5173) via Tailscale
:: Right-click → Run as administrator

netsh advfirewall firewall add rule name="Crypto Trading Backend 3001" dir=in action=allow protocol=TCP localport=3001
netsh advfirewall firewall add rule name="Crypto Trading Frontend 5173" dir=in action=allow protocol=TCP localport=5173

echo.
echo Firewall rules added for ports 3001 and 5173.
echo Test from Kali: curl http://100.119.48.19:3001/api/health
pause
