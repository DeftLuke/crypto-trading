#!/bin/bash
# Kill manual/nohup research-api processes (keep PM2-managed instance).
set -euo pipefail

API_PORT="${API_PORT:-8100}"

if pm2 describe research-api >/dev/null 2>&1; then
  echo "PM2 research-api is registered — use: pm2 restart research-api"
  exit 0
fi

pkill -f "uvicorn app.main:app.*${API_PORT}" 2>/dev/null && echo "Stopped orphan uvicorn on :${API_PORT}" || echo "No orphan uvicorn found"
