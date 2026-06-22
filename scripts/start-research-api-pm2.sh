#!/bin/bash
# Run research-api under PM2 (auto-restart on crash + survive reboot after pm2 save/startup).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ECOSYSTEM="$ROOT/deploy/ecosystem.research-api.config.cjs"
API_PORT="${API_PORT:-8100}"

sed -i 's/\r$//' "$ROOT/scripts/research-api-run.sh" 2>/dev/null || true
chmod +x "$ROOT/scripts/research-api-run.sh"
chmod +x "$ROOT/scripts/start-research-api-pm2.sh"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 not installed — run: npm install -g pm2"
  exit 1
fi

# Stop legacy nohup/manual uvicorn (not managed by PM2)
if pgrep -f "uvicorn app.main:app.*${API_PORT}" >/dev/null 2>&1; then
  if ! pm2 describe research-api >/dev/null 2>&1; then
    echo "Stopping orphan uvicorn on :${API_PORT}..."
    pkill -f "uvicorn app.main:app.*${API_PORT}" 2>/dev/null || true
    sleep 2
  fi
fi

if pm2 describe research-api >/dev/null 2>&1; then
  echo "Restarting PM2 research-api..."
  pm2 restart research-api --update-env
else
  echo "Starting PM2 research-api..."
  pm2 start "$ECOSYSTEM"
fi

pm2 save

for i in $(seq 1 45); do
  if curl -sf --max-time 5 "http://127.0.0.1:${API_PORT}/health" >/dev/null; then
    echo "research-api healthy on :${API_PORT} (PM2)"
    curl -sf "http://127.0.0.1:${API_PORT}/api/v1/institutional-smc/health" | head -c 240
    echo ""
    pm2 describe research-api | grep -E 'status|restarts|uptime' || pm2 list | grep research-api
    exit 0
  fi
  sleep 2
done

echo "research-api not healthy yet — check logs:"
echo "  pm2 logs research-api --lines 40"
pm2 logs research-api --lines 20 --nostream 2>/dev/null || true
exit 1
