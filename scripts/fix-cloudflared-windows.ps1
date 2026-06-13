# Run as Administrator: Right-click PowerShell -> Run as administrator
# Then: Set-ExecutionPolicy Bypass -Scope Process; .\fix-cloudflared-windows.ps1

Write-Host "=== Fix Cloudflare Tunnel (remove duplicate Windows connector) ===" -ForegroundColor Cyan

$service = Get-Service -Name cloudflared -ErrorAction SilentlyContinue
if ($service) {
    Write-Host "Stopping cloudflared service..."
    Stop-Service cloudflared -Force
    Set-Service cloudflared -StartupType Disabled
    & "C:\Program Files (x86)\cloudflared\cloudflared.exe" service uninstall
    Write-Host "Windows cloudflared removed." -ForegroundColor Green
} else {
    Write-Host "No cloudflared service found on Windows." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Testing domains (wait 30 seconds then open in Chrome):" -ForegroundColor Cyan
Start-Sleep -Seconds 5
try {
    $ai = Invoke-WebRequest -Uri "https://ai.deftluke.online/health" -TimeoutSec 15 -UseBasicParsing
    Write-Host "ai.deftluke.online: $($ai.StatusCode) OK" -ForegroundColor Green
    Write-Host $ai.Content
} catch {
    Write-Host "ai.deftluke.online: FAILED - wait 1 min and retry" -ForegroundColor Red
}
try {
    $n8n = Invoke-WebRequest -Uri "https://n8n.deftluke.online/healthz" -TimeoutSec 15 -UseBasicParsing
    Write-Host "n8n.deftluke.online: $($n8n.StatusCode) OK" -ForegroundColor Green
} catch {
    Write-Host "n8n.deftluke.online: FAILED - wait 1 min and retry" -ForegroundColor Red
}

Write-Host ""
Write-Host "Done. Only Kali should run the tunnel now." -ForegroundColor Green
Read-Host "Press Enter to close"
