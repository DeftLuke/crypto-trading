@echo off
:: DEPRECATED — use VPS deployment instead (docs/VPS-DEPLOY.md)
:: This stops when your PC loses power. Production runs on cloud VPS 24/7.
echo.
echo WARNING: Windows tunnel is deprecated. Deploy to VPS for always-on trading.
echo See docs\VPS-DEPLOY.md
echo.
pause

set CF=%USERPROFILE%\.cloudflared\cloudflared.exe
set CONFIG=%~dp0windows-cloudflared-config.yml

if not exist "%CF%" (
  echo Download cloudflared first or run from project scripts folder.
  pause
  exit /b 1
)

echo Starting LEGACY tunnel (dev only)...
"%CF%" tunnel --config "%CONFIG%" run 866ccee2-ad90-40a5-b04b-f88224e6e469
