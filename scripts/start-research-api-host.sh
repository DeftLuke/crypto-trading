#!/bin/bash
# Run research-api on Kali host under PM2 (auto-restart). Legacy nohup removed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec bash "$ROOT/scripts/start-research-api-pm2.sh"
