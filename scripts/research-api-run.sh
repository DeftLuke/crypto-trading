#!/bin/bash
# PM2 entrypoint — load deploy/.env and run research-api (institutional SMC + market data).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$ROOT/research-platform/.venv-linux"
ENV_FILE="$ROOT/deploy/.env"

if [ ! -d "$VENV" ]; then
  echo "Missing $VENV — create venv and install requirements first." >&2
  exit 1
fi

# shellcheck disable=SC1091
source "$VENV/bin/activate"

cd "$ROOT/research-platform"
rm -f .env

if [ -f "$ENV_FILE" ]; then
  eval "$(
    ENV_FILE="$ENV_FILE" python3 <<'PY'
import os, shlex
from dotenv import dotenv_values
for key, val in dotenv_values(os.environ["ENV_FILE"]).items():
    if key and val is not None:
        print(f"export {key}={shlex.quote(str(val))}")
PY
  )"
fi

# Trading-only overrides — institutional SMC + Parquet only (ignore legacy .env flags)
export SCHEDULER_ENABLED=false
export MEMORY_ENABLED=false
export AGENT_ENABLED=false
export DATABASE_REQUIRED=false
export PAPER_ENABLED=false
export LIVE_ENABLED=false
export PYTHONPATH="$ROOT/research-platform"
export API_HOST="${API_HOST:-0.0.0.0}"
export API_PORT="${API_PORT:-8100}"
export POLARS_MAX_THREADS="${POLARS_MAX_THREADS:-2}"
export MARKET_DATA_REFRESH_INTERVAL_SEC="${MARKET_DATA_REFRESH_INTERVAL_SEC:-45}"
export MARKET_DATA_ROOT="${MARKET_DATA_ROOT:-$ROOT/data/market_data}"
export MARKET_DATA_ENABLED="${MARKET_DATA_ENABLED:-true}"
export MARKET_DATA_AUTO_DOWNLOAD="${MARKET_DATA_AUTO_DOWNLOAD:-true}"
export MARKET_DATA_AUTO_UPDATE="${MARKET_DATA_AUTO_UPDATE:-true}"
export MARKET_DATA_PHASE_SIZE="${MARKET_DATA_PHASE_SIZE:-50}"
export MARKET_DATA_UNIVERSE_SIZE="${MARKET_DATA_UNIVERSE_SIZE:-200}"
export MARKET_DATA_MIN_QUOTE_VOLUME="${MARKET_DATA_MIN_QUOTE_VOLUME:-500000}"
export TRADING_API_URL="${TRADING_API_URL:-http://127.0.0.1:3002}"
export UVICORN_WORKERS="${UVICORN_WORKERS:-1}"
export UVICORN_LIMIT_CONCURRENCY="${UVICORN_LIMIT_CONCURRENCY:-24}"
export UVICORN_LIMIT_MAX_REQUESTS="${UVICORN_LIMIT_MAX_REQUESTS:-5000}"

mkdir -p "$ROOT/research-platform/data"

# Market-data downloads + Qdrant can open many files
ulimit -n 65536 2>/dev/null || ulimit -n 4096 2>/dev/null || true

exec uvicorn app.main:app \
  --host "$API_HOST" \
  --port "$API_PORT" \
  --workers "$UVICORN_WORKERS" \
  --limit-concurrency "$UVICORN_LIMIT_CONCURRENCY" \
  --limit-max-requests "$UVICORN_LIMIT_MAX_REQUESTS" \
  --timeout-keep-alive 5
