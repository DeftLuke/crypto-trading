#!/bin/bash
# Restart trading stack on Kali. Tries full Docker restart (sudo), else recovery backend on :3002.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY="$ROOT/deploy"
cd "$DEPLOY"

recover_backend() {
  echo "Recovery mode: fresh backend on 127.0.0.1:3002 (frozen container bypass)..."
  docker compose --profile telegram-ingestion build backend telegram-signal-service
  docker stop backend-recovery 2>/dev/null || true
  docker rm backend-recovery 2>/dev/null || true
  docker run -d --name backend-recovery --network crypto-trading_trading \
    -p 127.0.0.1:3002:3001 --env-file .env -e PORT=3001 -e NODE_ENV=production \
    -e RESEARCH_API_URL= \
    --dns 8.8.8.8 --dns 1.1.1.1 \
    -v "$DEPLOY/keys:/app/keys:ro" \
    crypto-trading-backend:latest

  if grep -q '127.0.0.1:3001' "${HOME}/.cloudflared/config.yml" 2>/dev/null; then
    sed -i 's|127.0.0.1:3001|127.0.0.1:3002|' "${HOME}/.cloudflared/config.yml"
    pkill -f 'cloudflared.*tunnel run' 2>/dev/null || true
    sleep 1
    nohup cloudflared --no-autoupdate --config "${HOME}/.cloudflared/config.yml" tunnel run >> /tmp/cloudflared.log 2>&1 &
  fi

  docker stop crypto-trading-telegram-signal-service-1 2>/dev/null || true
  docker rm crypto-trading-telegram-signal-service-1 2>/dev/null || true
  docker run -d --name crypto-trading-telegram-signal-service-1 --network crypto-trading_trading \
    --env-file .env \
    -e MAIN_TRADING_API_URL=http://backend-recovery:3001/api \
    -e TELEGRAM_SESSION_NAME=/app/data/kali_user_session \
    -e TELEGRAM_SERVICE_CONFIG=/app/config.json \
    -e SIGNAL_STORE_PATH=/app/data/signals.jsonl \
    -e AI_PARSER_ENABLED=true \
    -e AI_GATEWAY_URL=http://host.docker.internal:8080 \
    -e AI_PARSER_URL=http://host.docker.internal:8080/chat \
    --add-host=host.docker.internal:host-gateway \
    -v "$ROOT/telegram-signal-service/config.json:/app/config.json:ro" \
    -v "$ROOT/telegram-signal-service/data:/app/data:rw" \
    --restart always crypto-trading-telegram-signal-service:latest

  docker compose up -d frontend analytics-dashboard redis qdrant --no-deps 2>/dev/null || true
}

if sudo -n true 2>/dev/null; then
  echo "Restarting Docker..."
  sudo systemctl restart docker
  sleep 8
  docker compose --profile telegram-ingestion up -d backend frontend analytics-dashboard telegram-signal-service redis qdrant
else
  echo "No passwordless sudo — using recovery backend (run: sudo systemctl restart docker when you can)."
  recover_backend
fi

echo "Waiting for API..."
for i in $(seq 1 30); do
  if curl -sf --max-time 5 http://127.0.0.1:3002/api/health >/dev/null 2>&1 \
    || curl -sf --max-time 5 http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
    echo "API OK"
    exit 0
  fi
  sleep 2
done
echo "Health check failed — see: docker logs backend-recovery"
exit 1
