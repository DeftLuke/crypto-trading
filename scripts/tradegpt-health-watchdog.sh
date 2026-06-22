#!/bin/bash
# Restarts backend-recovery if API health fails (cron/systemd timer every 2 min)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${HOME}/.tradegpt"
LOG="$LOG_DIR/watchdog.log"
HEALTH_URL="${TRADEGPT_HEALTH_URL:-http://127.0.0.1:3002/api/health}"
RESEARCH_HEALTH_URL="${RESEARCH_API_HEALTH_URL:-http://127.0.0.1:8100/health}"
mkdir -p "$LOG_DIR"

log() {
  echo "$(date -Is) $*" >> "$LOG"
}

recover_research_api() {
  if curl -sf --max-time 10 "$RESEARCH_HEALTH_URL" >/dev/null 2>&1; then
    return 0
  fi
  log "research-api UNHEALTHY — restarting via PM2"
  if command -v pm2 >/dev/null 2>&1; then
    if pm2 describe research-api >/dev/null 2>&1; then
      pm2 restart research-api >> "$LOG" 2>&1 || true
    else
      bash "$ROOT/scripts/start-research-api-pm2.sh" >> "$LOG" 2>&1 || log "start-research-api-pm2 failed"
    fi
    sleep 8
    if curl -sf --max-time 10 "$RESEARCH_HEALTH_URL" >/dev/null 2>&1; then
      log "research-api recovery OK"
    else
      log "research-api recovery FAILED — pm2 logs research-api"
    fi
  else
    log "pm2 missing — cannot restart research-api"
  fi
}

recover_research_api

if curl -sf --max-time 10 "$HEALTH_URL" >/dev/null 2>&1; then
  exit 0
fi

log "UNHEALTHY — attempting recovery"

if docker inspect backend-recovery >/dev/null 2>&1; then
  status="$(docker inspect -f '{{.State.Status}}' backend-recovery)"
  exit_code="$(docker inspect -f '{{.State.ExitCode}}' backend-recovery)"
  policy="$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' backend-recovery)"
  log "container status=$status exit=$exit_code restart_policy=$policy"

  if [ "$policy" = "no" ]; then
    log "restart policy was 'no' — recreating with --restart always"
    bash "$ROOT/scripts/run-backend-recovery.sh" >> "$LOG" 2>&1 || log "run-backend-recovery failed"
    exit 0
  fi

  if [ "$status" = "running" ]; then
    log "container running but health failed — restarting container"
    docker restart backend-recovery >> "$LOG" 2>&1 || true
  else
    log "starting exited container"
    docker start backend-recovery >> "$LOG" 2>&1 || bash "$ROOT/scripts/run-backend-recovery.sh" >> "$LOG" 2>&1
  fi
else
  log "backend-recovery missing — creating"
  bash "$ROOT/scripts/run-backend-recovery.sh" >> "$LOG" 2>&1 || log "run-backend-recovery failed"
fi

sleep 5
if curl -sf --max-time 10 "$HEALTH_URL" >/dev/null 2>&1; then
  log "recovery OK"
else
  log "recovery FAILED — check docker logs backend-recovery"
fi
