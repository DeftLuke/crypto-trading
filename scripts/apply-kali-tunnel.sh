#!/bin/bash
# Run on Kali: bash apply-kali-tunnel.sh
# Sets Cloudflare tunnel routes for all deftluke.online services

set -e

WINDOWS_IP="${WINDOWS_TAILSCALE_IP:-100.119.48.19}"
CONFIG_SRC="$(dirname "$0")/kali-cloudflared-config.yml"
CONFIG_DST="$HOME/.cloudflared/config.yml"

mkdir -p "$HOME/.cloudflared"
sed "s/WINDOWS_TAILSCALE_IP/$WINDOWS_IP/g" "$CONFIG_SRC" > "$CONFIG_DST"

echo "Wrote $CONFIG_DST with Windows backend at $WINDOWS_IP"
sudo systemctl restart cloudflared
sleep 2
systemctl is-active cloudflared

echo ""
echo "Public URLs (no Tailscale required):"
echo "  https://api.deftluke.online/health"
echo "  https://trade.deftluke.online"
echo "  https://ai.deftluke.online/health"
echo "  https://n8n.deftluke.online/healthz"
