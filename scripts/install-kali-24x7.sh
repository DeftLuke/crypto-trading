#!/bin/bash
# Install 24/7 auto-restart for TradeGPT on Kali (systemd + PM2 + Docker --restart always)
# Run on Kali: bash ~/crypto-trading/scripts/install-kali-24x7.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
USER_NAME="${SUDO_USER:-$USER}"

echo "=== TradeGPT 24/7 install ==="

# Fix Windows CRLF if scripts were copied from a PC
for f in "$ROOT/scripts/run-backend-recovery.sh" "$ROOT/scripts/tradegpt-health-watchdog.sh" \
  "$ROOT/scripts/install-kali-24x7.sh" "$ROOT/scripts/research-api-run.sh" \
  "$ROOT/scripts/start-research-api-pm2.sh" "$ROOT/scripts/stop-research-api-legacy.sh"; do
  sed -i 's/\r$//' "$f" 2>/dev/null || true
done

chmod +x "$ROOT/scripts/run-backend-recovery.sh"
chmod +x "$ROOT/scripts/tradegpt-health-watchdog.sh"
chmod +x "$ROOT/scripts/restart-kali-stack.sh"
chmod +x "$ROOT/scripts/research-api-run.sh"
chmod +x "$ROOT/scripts/start-research-api-pm2.sh"
chmod +x "$ROOT/scripts/stop-research-api-legacy.sh"

# --- Docker backend with --restart always ---
bash "$ROOT/scripts/run-backend-recovery.sh"

# --- systemd: boot + watchdog (requires sudo once) ---
if sudo -n true 2>/dev/null; then
  sudo cp "$ROOT/deploy/systemd/tradegpt-backend.service" /etc/systemd/system/
  sudo cp "$ROOT/deploy/systemd/tradegpt-watchdog.service" /etc/systemd/system/
  sudo cp "$ROOT/deploy/systemd/tradegpt-watchdog.timer" /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl enable tradegpt-backend.service
  sudo systemctl enable tradegpt-watchdog.timer
  sudo systemctl start tradegpt-backend.service 2>/dev/null || true
  sudo systemctl start tradegpt-watchdog.timer
  echo "systemd: tradegpt-backend + watchdog timer enabled"
else
  echo "No passwordless sudo — installing cron watchdog (every 2 min) instead."
  (crontab -l 2>/dev/null | grep -v tradegpt-health-watchdog; \
    echo "*/2 * * * * /bin/bash $ROOT/scripts/tradegpt-health-watchdog.sh >/dev/null 2>&1") | crontab -
  echo "cron: tradegpt-health-watchdog every 2 minutes"
  echo "Tip: for systemd on boot, run once: sudo bash $ROOT/scripts/install-kali-24x7.sh"
fi

# --- PM2: research-api + analytics dashboard survive reboot ---
if command -v pm2 >/dev/null 2>&1; then
  bash "$ROOT/scripts/start-research-api-pm2.sh" || echo "research-api PM2 start failed — check pm2 logs research-api"
  pm2 save 2>/dev/null || true
  if sudo -n true 2>/dev/null; then
    pm2 startup systemd -u "$USER_NAME" --hp "/home/$USER_NAME" 2>/dev/null | grep -v PM2 | sudo bash 2>/dev/null || true
  fi
  echo "PM2: saved process list (research-api, analytics-dashboard, …)"
fi

# --- cloudflared on boot ---
if systemctl list-unit-files cloudflared.service >/dev/null 2>&1; then
  sudo systemctl enable cloudflared 2>/dev/null || true
fi

echo ""
echo "=== Status ==="
docker inspect backend-recovery --format 'backend: {{.State.Status}} restart={{.HostConfig.RestartPolicy.Name}}' 2>/dev/null || echo "backend: not found"
curl -sf http://127.0.0.1:3002/api/health && echo " backend health OK" || echo " backend health FAILED"
curl -sf http://127.0.0.1:8100/health && echo " research-api health OK" || echo " research-api health FAILED"
systemctl is-active tradegpt-watchdog.timer 2>/dev/null && echo "watchdog timer: active" || echo "watchdog timer: install with sudo"
pm2 list 2>/dev/null | grep -E 'research-api|analytics' || true
echo ""
echo "Watchdog log: ~/.tradegpt/watchdog.log"
echo "Done — backend restarts automatically on crash and after reboot."
