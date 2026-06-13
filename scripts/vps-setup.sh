#!/bin/bash
# One-time VPS setup — Ubuntu 22.04/24.04 (Hetzner, DigitalOcean, Oracle, etc.)
# Run as root or with sudo on your cloud server:
#   curl -fsSL https://raw.githubusercontent.com/DeftLuke/crypto-trading/main/scripts/vps-setup.sh | bash
# Or after clone:
#   bash scripts/vps-setup.sh

set -e

REPO_DIR="${REPO_DIR:-$HOME/crypto-trading}"
DEPLOY_DIR="$REPO_DIR/deploy"

echo "=== Crypto Trading VPS Setup ==="
echo "No Tailscale. No Windows PC required after this."
echo ""

# Docker
if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  usermod -aG docker "$USER" 2>/dev/null || true
fi

# Clone or update repo
if [ ! -d "$REPO_DIR/.git" ]; then
  echo "Cloning repository..."
  git clone https://github.com/DeftLuke/crypto-trading.git "$REPO_DIR"
else
  echo "Updating repository..."
  git -C "$REPO_DIR" pull --ff-only || true
fi

# Env file
if [ ! -f "$DEPLOY_DIR/.env" ]; then
  cp "$DEPLOY_DIR/.env.example" "$DEPLOY_DIR/.env"
  echo ""
  echo "Created $DEPLOY_DIR/.env — EDIT THIS NOW with your secrets:"
  echo "  - CLOUDFLARE_TUNNEL_TOKEN"
  echo "  - SUPABASE_*, TELEGRAM_*, BINANCE_*, AI_API_KEY"
  echo ""
  echo "Then run: cd $DEPLOY_DIR && docker compose up -d --build"
  exit 0
fi

cd "$DEPLOY_DIR"

echo "Building and starting all services (backend, frontend, n8n, AI, tunnel)..."
docker compose up -d --build

echo ""
echo "=== Stack started ==="
echo "Check status:  cd $DEPLOY_DIR && docker compose ps"
echo "View logs:     docker compose logs -f backend"
echo ""
echo "IMPORTANT — stop local tunnel on Windows:"
echo "  Close start-windows-tunnel.bat (only ONE cloudflared connector allowed)"
echo ""
echo "Verify (after 2–5 min for models):"
echo "  curl https://api.deftluke.online/api/health"
echo "  curl https://ai.deftluke.online/health"
echo "  curl -I https://trade.deftluke.online"
echo "  curl https://n8n.deftluke.online/healthz"
