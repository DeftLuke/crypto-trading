#!/bin/bash
# Configure AI gateway systemd service on Kali
# Usage: AI_API_KEY=your-key bash configure-ai-subdomain.sh

set -e

AI_PORT="${AI_PORT:-8080}"
BACKEND_URL="${BACKEND_URL:-https://api.deftluke.online}"
AI_API_KEY="${AI_API_KEY:-change-me}"
GATEWAY_DIR="${GATEWAY_DIR:-$HOME/ai-agent-gateway}"

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
Environment=AI_API_KEY=$AI_API_KEY
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable ai-agent
sudo systemctl restart ai-agent
sleep 2

curl -s "http://127.0.0.1:$AI_PORT/health" | head -c 400
echo ""
echo "Public: https://ai.deftluke.online/health"
echo "Set AI_API_KEY in n8n and backend .env to match."
