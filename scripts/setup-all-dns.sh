#!/bin/bash
# Register all deftluke.online subdomains in Cloudflare DNS via cloudflared
# Run on Kali (where cloudflared is authenticated):
#   bash scripts/setup-all-dns.sh

set -e

TUNNEL="${CLOUDFLARE_TUNNEL_ID:-866ccee2-ad90-40a5-b04b-f88224e6e469}"
DOMAIN="${CLOUDFLARE_DOMAIN:-deftluke.online}"

HOSTS=(
  "n8n.${DOMAIN}"
  "ai.${DOMAIN}"
  "api.${DOMAIN}"
  "trade.${DOMAIN}"
)

echo "Tunnel: $TUNNEL"
echo "Registering DNS CNAME records..."

for host in "${HOSTS[@]}"; do
  echo "  → $host"
  cloudflared tunnel route dns -f "$TUNNEL" "$host" 2>&1 || true
done

echo ""
echo "Done. DNS may take 1–5 minutes to propagate."
echo ""
echo "Verify:"
for host in "${HOSTS[@]}"; do
  echo "  curl -I https://${host}/"
done
