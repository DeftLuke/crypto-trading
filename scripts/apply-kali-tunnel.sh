#!/bin/bash
# Apply Cloudflare tunnel routes on Kali — everything on localhost (Docker stack)
# Run on Kali: bash scripts/apply-kali-tunnel.sh

set -e

CONFIG_SRC="$(dirname "$0")/kali-cloudflared-config.yml"
CONFIG_DST="${HOME}/.cloudflared/config.yml"
CREDS="${HOME}/.cloudflared/866ccee2-ad90-40a5-b04b-f88224e6e469.json"

mkdir -p "${HOME}/.cloudflared"

if [ ! -f "$CREDS" ]; then
  echo "Missing tunnel credentials: $CREDS"
  echo "Copy from Windows: C:\\Users\\<you>\\.cloudflared\\866ccee2-ad90-40a5-b04b-f88224e6e469.json"
  echo "Or create token: cloudflared tunnel login"
  exit 1
fi

cp "$CONFIG_SRC" "$CONFIG_DST"
echo "Wrote $CONFIG_DST (all services → 127.0.0.1, no Tailscale)"

if systemctl is-enabled cloudflared &>/dev/null; then
  sudo systemctl restart cloudflared
  sleep 2
  systemctl is-active cloudflared
else
  echo ""
  echo "Install cloudflared systemd service (one-time):"
  echo "  sudo cloudflared service install"
  echo "  sudo systemctl enable cloudflared"
  echo "  sudo systemctl start cloudflared"
fi

echo ""
echo "Public URLs (free, stable — better than ngrok):"
echo "  https://api.deftluke.online/api/health"
echo "  https://trade.deftluke.online"
echo "  https://ai.deftluke.online/health"
echo "  https://n8n.deftluke.online/healthz"
