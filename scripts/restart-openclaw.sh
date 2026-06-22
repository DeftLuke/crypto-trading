#!/bin/bash
# Restart OpenClaw gateway with crypto-trading workspace
set -euo pipefail

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"

CONFIG="$HOME/.openclaw/openclaw.json"

echo "Workspace: $(node -pe "JSON.parse(require('fs').readFileSync('$CONFIG','utf8')).agents.defaults.workspace")"

if systemctl --user restart openclaw-gateway.service 2>/dev/null; then
  sleep 5
else
  echo "systemd unavailable — restarting manually..."
  pkill -f 'openclaw gateway' 2>/dev/null || true
  sleep 2
  nohup openclaw gateway run --port 18789 >> /tmp/openclaw-gateway.log 2>&1 &
  sleep 8
fi

curl -sf --max-time 10 http://127.0.0.1:18789/health && echo " — OpenClaw OK" || {
  echo "Health check failed — tail /tmp/openclaw-gateway.log"
  tail -30 /tmp/openclaw-gateway.log 2>/dev/null || true
  exit 1
}
