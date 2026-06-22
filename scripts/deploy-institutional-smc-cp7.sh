#!/bin/bash
# CP7 — Deploy institutional SMC to Kali production
# Run ON the Kali VPS: bash scripts/deploy-institutional-smc-cp7.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== CP7 Institutional SMC Production Deploy ==="
echo "Repo: $ROOT"
echo ""

# ── 1. Pull latest (if git remote configured) ──
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "→ Git status"
  git status -sb | head -5
  if git remote get-url origin >/dev/null 2>&1; then
    echo "→ git pull"
    git pull --ff-only || echo "WARN: git pull failed — continuing with local tree"
  fi
fi

# ── 2. Build images ──
echo ""
echo "→ Building research-api..."
docker compose -f deploy/docker-compose.yml build research-api

echo "→ Building backend..."
docker compose -f deploy/docker-compose.yml --profile legacy build backend

# Optional: rebuild analytics dashboard for Risk page engine toggle
if [ "${DEPLOY_DASHBOARD:-true}" = "true" ]; then
  echo "→ Building analytics-dashboard..."
  docker compose -f deploy/docker-compose.yml build analytics-dashboard || echo "WARN: dashboard build skipped"
fi

# ── 3. Start research-api stack ──
echo ""
bash scripts/start-research-api.sh

# ── 4. Restart backend-recovery ──
echo ""
bash scripts/run-backend-recovery.sh

# ── 5. Restart analytics dashboard (optional) ──
if [ "${DEPLOY_DASHBOARD:-true}" = "true" ]; then
  echo ""
  echo "→ Restarting analytics-dashboard..."
  docker compose -f deploy/docker-compose.yml up -d analytics-dashboard
fi

# ── 6. Verify ──
echo ""
echo "→ Waiting for services..."
sleep 5

echo "→ Research-api health:"
curl -sf http://127.0.0.1:8100/api/v1/institutional-smc/health | head -c 400
echo ""

echo "→ Backend health:"
curl -sf http://127.0.0.1:3002/api/health | head -c 400
echo ""

echo "→ Institutional proxy:"
curl -sf http://127.0.0.1:3002/api/institutional-smc/health | head -c 500
echo ""

echo "→ Signal engine status:"
curl -sf http://127.0.0.1:3002/api/signal-engine/status | head -c 400
echo ""

# ── 7. Parity tests ──
echo ""
echo "→ Running parity verification..."
cd backend
TRADING_API_URL=http://127.0.0.1:3002/api \
RESEARCH_API_URL=http://127.0.0.1:8100 \
node scripts/verify-institutional-smc-deploy.js

echo ""
echo "=== CP7 deploy complete ==="
echo "Next: toggle engine on Risk page → https://trade.deftluke.online/risk"
echo "Or: curl -X POST http://127.0.0.1:3002/api/signal-engine -H 'Content-Type: application/json' -d '{\"signal_engine\":\"institutional-smc\"}'"
