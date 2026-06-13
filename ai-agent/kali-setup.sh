#!/bin/bash
# Run on Kali server — Ollama + AI gateway + cloudflared prep
# Usage: CLOUDFLARE_TUNNEL_TOKEN=xxx WINDOWS_TAILSCALE_IP=100.x.x.x bash kali-setup.sh

set -e

BACKEND_URL="${BACKEND_URL:-https://api.deftluke.online}"
WINDOWS_IP="${WINDOWS_TAILSCALE_IP:-100.119.48.19}"
N8N_PORT="${N8N_PORT:-5678}"
AI_PORT="${AI_PORT:-8080}"

echo "=== 1. Install Ollama ==="
if ! command -v ollama &>/dev/null; then
  curl -fsSL https://ollama.com/install.sh | sh
fi

echo "=== 2. Pull AI models ==="
ollama pull qwen2.5:7b-instruct || true
ollama pull mistral:7b || true
ollama pull nomic-embed-text || true

echo "=== 3. AI Agent Gateway ==="
GATEWAY_DIR="$HOME/ai-agent-gateway"
mkdir -p "$GATEWAY_DIR/prompts"
# Copy gateway files from repo: scp -r ai-agent/gateway/* kali:~/ai-agent-gateway/

sudo tee /etc/systemd/system/ai-agent.service > /dev/null << EOF
[Unit]
Description=AI Trading Agent Gateway
After=network.target ollama.service

[Service]
Type=simple
User=$USER
WorkingDirectory=$GATEWAY_DIR
Environment=AI_GATEWAY_PORT=$AI_PORT
Environment=OLLAMA_URL=http://127.0.0.1:11434
Environment=OLLAMA_MODEL=qwen2.5:7b-instruct
Environment=OLLAMA_FALLBACK=mistral:7b
Environment=BACKEND_URL=$BACKEND_URL
Environment=AI_API_KEY=\${AI_API_KEY:-change-me}
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable ai-agent
sudo systemctl restart ai-agent

echo "=== 4. Cloudflare tunnel config ==="
mkdir -p "$HOME/.cloudflared"
if [ -f "$HOME/crypto-trading/scripts/kali-cloudflared-config.yml" ]; then
  sed "s/WINDOWS_TAILSCALE_IP/$WINDOWS_IP/g" \
    "$HOME/crypto-trading/scripts/kali-cloudflared-config.yml" > "$HOME/.cloudflared/config.yml"
  sudo systemctl restart cloudflared || echo "Install cloudflared service with your tunnel token first"
fi

echo "=== Done ==="
echo "AI Gateway: https://ai.deftluke.online/health"
echo "Backend:    $BACKEND_URL/api/health"
echo "n8n:        https://n8n.deftluke.online"
