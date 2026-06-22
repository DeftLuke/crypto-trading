#!/bin/bash
# Start research-api + dependencies on Kali (redis, qdrant)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/deploy"

echo "Starting redis, qdrant, research-api..."
docker compose up -d redis qdrant research-api

for i in $(seq 1 30); do
  if curl -sf --max-time 3 http://127.0.0.1:8100/health >/dev/null; then
    echo "research-api healthy on :8100"
    curl -sf http://127.0.0.1:8100/health | head -c 200
    echo ""
    exit 0
  fi
  sleep 2
done

echo "research-api not healthy — check: docker compose logs research-api --tail 40"
exit 1
