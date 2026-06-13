#!/bin/bash
# Deploy full trading stack on Kali — 24/7, no VPS, no Tailscale, no Windows PC
# Run on Kali:
#   git clone https://github.com/DeftLuke/crypto-trading.git ~/crypto-trading
#   cd ~/crypto-trading && bash scripts/kali-deploy.sh

set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_DIR="$REPO_DIR/deploy"
USER_NAME="${SUDO_USER:-$USER}"

echo "=============================================="
echo "  Crypto Trading — Kali 24/7 Deploy"
echo "  Public URLs via Cloudflare (FREE, not ngrok)"
echo "=============================================="
echo ""

# --- Docker ---
if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo systemctl enable docker
  sudo systemctl start docker
  sudo usermod -aG docker "$USER_NAME" 2>/dev/null || true
  echo "Log out and back in if docker permission denied, then re-run this script."
fi

# Stop old standalone AI if using native services (hybrid mode keeps host ollama + ai-agent)
echo "Stopping conflicting services..."
sudo systemctl stop cloudflared 2>/dev/null || true

USE_NATIVE_AI=false
if systemctl is-active ai-agent &>/dev/null && curl -sf http://127.0.0.1:8080/health >/dev/null 2>&1; then
  USE_NATIVE_AI=true
  echo "Using existing native AI gateway on :8080"
fi

USE_NATIVE_N8N=false
if docker ps --format '{{.Names}}' | grep -q '^n8n-n8n-1$'; then
  USE_NATIVE_N8N=true
  echo "Using existing n8n container on :5678"
fi

COMPOSE_PROFILES=""
if [ "$USE_NATIVE_AI" = false ] || [ "$USE_NATIVE_N8N" = false ]; then
  COMPOSE_PROFILES="full-stack"
  sudo systemctl stop ai-agent 2>/dev/null || true
  sudo systemctl stop ollama 2>/dev/null || true
fi

# --- Env ---
if [ ! -f "$DEPLOY_DIR/.env" ]; then
  cp "$DEPLOY_DIR/.env.example" "$DEPLOY_DIR/.env"
  echo ""
  echo "Created $DEPLOY_DIR/.env"
  echo "Edit it NOW with your secrets (Supabase, Telegram, Binance, AI_API_KEY):"
  echo "  nano $DEPLOY_DIR/.env"
  echo ""
  echo "Then run this script again."
  exit 0
fi

# --- Build & start ---
cd "$DEPLOY_DIR"

if [ "$USE_NATIVE_AI" = true ]; then
  export AI_GATEWAY_URL=http://host.docker.internal:8080
  export OLLAMA_URL=http://host.docker.internal:11434
fi

echo "Starting Docker stack..."
if [ -n "$COMPOSE_PROFILES" ]; then
  COMPOSE_PROFILES="$COMPOSE_PROFILES" docker compose up -d --build
else
  docker compose up -d --build backend frontend
fi

echo "Waiting for backend..."
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
    echo "Backend OK"
    break
  fi
  sleep 2
done

# --- Cloudflare tunnel (systemd on host) ---
echo "Applying Cloudflare tunnel config..."
bash "$REPO_DIR/scripts/apply-kali-tunnel.sh"

# --- Auto-start on boot ---
echo "Enabling auto-start on Kali reboot..."
sudo tee /etc/systemd/system/crypto-trading.service > /dev/null << EOF
[Unit]
Description=Crypto Trading Docker Stack
After=docker.service network-online.target
Requires=docker.service
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
User=$USER_NAME
WorkingDirectory=$DEPLOY_DIR
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable crypto-trading.service
sudo systemctl enable cloudflared 2>/dev/null || true
sudo systemctl start cloudflared 2>/dev/null || true

echo ""
echo "=============================================="
echo "  DONE — Kali runs everything 24/7"
echo "=============================================="
echo ""
echo "Stop Windows tunnel (important — only ONE connector):"
echo "  taskkill /F /IM cloudflared.exe   (on Windows)"
echo ""
echo "Verify:"
echo "  curl http://127.0.0.1:3001/api/health"
echo "  curl https://api.deftluke.online/api/health"
echo "  curl https://ai.deftluke.online/health"
echo ""
echo "Logs:  cd $DEPLOY_DIR && docker compose logs -f backend"
echo "Status: docker compose ps"
echo ""
echo "Tip: plug Kali into a UPS so it survives short power cuts."
