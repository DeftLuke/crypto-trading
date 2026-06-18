#!/bin/bash
# Production 24/7 setup on Kali — public Cloudflare tunnel, no Tailscale required.
# Run on Kali: bash ~/crypto-trading/scripts/production-kali.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY="$ROOT/deploy"
ENV_FILE="$DEPLOY/.env"

echo "=== TradeGPT Production Setup ==="

# 1) Tunnel config (public HTTPS via Cloudflare — NOT Tailscale)
bash "$ROOT/scripts/apply-kali-tunnel.sh" || true

# 2) Ensure cloudflared starts on boot (skip if no passwordless sudo)
if systemctl is-active cloudflared &>/dev/null; then
  echo "cloudflared already active"
elif sudo -n systemctl restart cloudflared 2>/dev/null; then
  echo "cloudflared restarted"
else
  echo "Note: run manually if needed: sudo systemctl restart cloudflared"
fi

# 3) Generate INTERNAL_API_SECRET if missing
if [ -f "$ENV_FILE" ] && ! grep -q '^INTERNAL_API_SECRET=' "$ENV_FILE" 2>/dev/null; then
  SECRET=$(openssl rand -hex 32)
  echo "INTERNAL_API_SECRET=$SECRET" >> "$ENV_FILE"
  echo "Added INTERNAL_API_SECRET to deploy/.env"
fi

# 4) Production CORS
if [ -f "$ENV_FILE" ] && ! grep -q '^CORS_ORIGINS=' "$ENV_FILE" 2>/dev/null; then
  echo 'CORS_ORIGINS=https://trade.deftluke.online,https://terminal.deftluke.online' >> "$ENV_FILE"
fi

# 5) Docker stack — backend-recovery on :3002 only (compose backend :3001 is legacy)
cd "$DEPLOY"
docker compose stop backend 2>/dev/null || true
docker compose rm -f backend 2>/dev/null || true
docker compose build analytics-dashboard frontend 2>&1 | tail -5
docker compose --profile legacy build backend 2>&1 | tail -3

# Recovery backend on :3002 (keys + DNS)
docker stop backend-recovery 2>/dev/null || true
docker rm backend-recovery 2>/dev/null || true
docker run -d --name backend-recovery \
  --restart unless-stopped \
  --network crypto-trading_trading \
  -p 127.0.0.1:3002:3001 \
  --env-file "$ENV_FILE" \
  -e PORT=3001 \
  -e NODE_ENV=production \
  -e CONTROL_AUTO_TRADING=true \
  -e CONTROL_MANUAL_APPROVAL=false \
  -e AI_GATEWAY_URL=https://ai.deftluke.online \
  --dns 8.8.8.8 --dns 1.1.1.1 \
  -v "$DEPLOY/keys:/app/keys:ro" \
  crypto-trading-backend:latest

docker compose up -d frontend analytics-dashboard redis qdrant telegram-signal-service --no-deps 2>/dev/null || \
  docker compose up -d frontend analytics-dashboard redis qdrant --no-deps

# Remove legacy :3001 backend if present (production uses backend-recovery on :3002)
docker stop crypto-trading-backend-1 2>/dev/null || true
docker rm -f crypto-trading-backend-1 2>/dev/null || true

# Remove stale duplicate containers from failed compose runs
docker ps -a --filter "status=created" --format '{{.ID}}' | xargs -r docker rm -f 2>/dev/null || true

# 6) Health wait
echo "Waiting for services..."
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:3002/api/health >/dev/null; then
    echo "Backend OK"
    break
  fi
  sleep 2
done

# 7) Public URL test
echo ""
echo "=== Public URL checks ==="
for url in \
  "https://api.deftluke.online/api/health" \
  "https://trade.deftluke.online" \
  "https://terminal.deftluke.online" \
  "https://n8n.deftluke.online/healthz" \
  "https://ai.deftluke.online/health"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$url" || echo "000")
  echo "  $code  $url"
done

echo ""
echo "=== Done ==="
echo "No nginx required — Cloudflare Tunnel handles HTTPS."
echo "No Tailscale required — DNS points to Cloudflare edge."
echo ""
echo "If browser still asks for login, disable Cloudflare Access:"
echo "  Zero Trust → Access → Applications → remove/bypass policies for *.deftluke.online"
echo ""
echo "Stop Windows cloudflared (only ONE connector allowed):"
echo "  taskkill /F /IM cloudflared.exe"
