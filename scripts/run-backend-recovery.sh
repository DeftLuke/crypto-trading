#!/bin/bash
# Production backend on Kali — always restart on crash, bind :3002
# Usage: bash scripts/run-backend-recovery.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY="$ROOT/deploy"
ENV_FILE="$DEPLOY/.env"
NETWORK="${TRADEGPT_DOCKER_NETWORK:-crypto-trading_trading}"
IMAGE="${TRADEGPT_BACKEND_IMAGE:-crypto-trading-backend:latest}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE — copy deploy/.env.example and configure secrets first."
  exit 1
fi

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Building $IMAGE..."
  docker compose -f "$DEPLOY/docker-compose.yml" --profile legacy build backend
fi

docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK"

echo "Starting backend-recovery (--restart always) on 127.0.0.1:3002..."
docker stop backend-recovery 2>/dev/null || true
docker rm backend-recovery 2>/dev/null || true

# Scanner on/off comes from deploy/.env (SCANNER_AUTO_START). Docker --restart always recovers if Node crashes.
docker run -d \
  --name backend-recovery \
  --restart always \
  --network "$NETWORK" \
  -p 127.0.0.1:3002:3001 \
  --env-file "$ENV_FILE" \
  -e PORT=3001 \
  -e NODE_ENV=production \
  -e NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=16384}" \
  -e RESEARCH_API_URL="${RESEARCH_API_URL:-http://host.docker.internal:8100}" \
  -e REDIS_URL="${REDIS_URL:-redis://redis:6379/1}" \
  -e CONTROL_AUTO_TRADING="${CONTROL_AUTO_TRADING:-true}" \
  -e CONTROL_MANUAL_APPROVAL="${CONTROL_MANUAL_APPROVAL:-false}" \
  -e AI_GATEWAY_URL="${AI_GATEWAY_URL:-https://ai.deftluke.online}" \
  --dns 8.8.8.8 \
  --dns 1.1.1.1 \
  --add-host=host.docker.internal:host-gateway \
  -v "$DEPLOY/keys:/app/keys:ro" \
  "$IMAGE"

for i in $(seq 1 30); do
  if curl -sf --max-time 5 http://127.0.0.1:3002/api/health >/dev/null; then
    echo "backend-recovery healthy"
    docker inspect backend-recovery --format 'RestartPolicy={{.HostConfig.RestartPolicy.Name}} Status={{.State.Status}}'
    exit 0
  fi
  sleep 2
done

echo "Health check failed — see: docker logs backend-recovery --tail 50"
exit 1
