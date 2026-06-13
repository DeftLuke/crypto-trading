# Windows firewall — allow Kali tunnel to reach backend + dashboard
# Run PowerShell as Administrator:

New-NetFirewallRule -DisplayName "Crypto Trading Backend 3001" `
  -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow

New-NetFirewallRule -DisplayName "Crypto Trading Frontend 5173" `
  -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow

# Verify Tailscale can reach you (run on Kali):
#   curl http://YOUR_WINDOWS_TAILSCALE_IP:3001/api/health
