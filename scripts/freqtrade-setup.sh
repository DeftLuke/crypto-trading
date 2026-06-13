#!/usr/bin/env bash
# One-time Freqtrade setup on Kali/VPS
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/deploy"

echo "==> Creating freqtrade data dirs"
mkdir -p "$ROOT/freqtrade/user_data/logs" "$ROOT/freqtrade/user_data/data"

if ! grep -q FREQTRADE_API_PASSWORD deploy/.env 2>/dev/null; then
  echo "Add FREQTRADE_* vars from freqtrade/.env.example to deploy/.env"
fi

echo "==> Pulling Freqtrade image"
docker compose --profile freqtrade pull freqtrade

echo "==> Listing strategies"
docker compose --profile freqtrade run --rm freqtrade list-strategies \
  --strategy-path user_data/strategies

echo ""
echo "Done. Start with:"
echo "  cd deploy && docker compose --profile freqtrade up -d freqtrade"
echo "See freqtrade/README.md for backtest workflow."
