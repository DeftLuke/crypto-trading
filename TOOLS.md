# TOOLS.md — TradeGPT Server Cheat Sheet

## SSH / host

- **Kali VPS** — user `kali`, repo `/home/kali/crypto-trading`
- **SSH (Tailscale):** `ssh kali@100.110.210.103` — use this for deploy/logs (not `deftluke.online`; that hostname is Cloudflare HTTPS only)
- **Public HTTPS:** `https://api.deftluke.online`, `https://trade.deftluke.online` (via Cloudflare tunnel)
- Deploy env: `deploy/.env` (secrets — do not echo)

## Docker

| Container | Port | Role |
|-----------|------|------|
| `backend-recovery` | 3002→3001 | Main Node API, scanner, trades |
| `crypto-trading-frontend-1` | — | trade.deftluke.online |
| `crypto-trading-analytics-dashboard-1` | 3000 | Terminal dashboard |
| `research-api` (PM2 host) | 8100 | Python SMC + market data (`pm2 restart research-api`) |
| `n8n-n8n-1` | — | n8n.deftluke.online |
| `crypto-trading-redis-1` | 6380 | Redis |
| `crypto-trading-qdrant-1` | 6333 | Vector memory |

Restart backend:
```bash
bash ~/crypto-trading/scripts/run-backend-recovery.sh
```

Restart research-api (PM2, auto-restart on crash):
```bash
bash ~/crypto-trading/scripts/start-research-api-pm2.sh
# or: pm2 restart research-api && pm2 logs research-api --lines 50
```

Rebuild backend image:
```bash
cd ~/crypto-trading/deploy && docker compose --profile legacy build backend
```

## APIs (localhost on Kali)

- Health: `curl -s http://127.0.0.1:3002/api/health`
- Paper dashboard: `curl -s http://127.0.0.1:3002/api/paper/dashboard`
- AI query: `POST http://127.0.0.1:3002/api/ai/query` `{ "question", "chatId" }`
- OpenClaw health: `curl -s http://127.0.0.1:18789/health`

Public: `https://api.deftluke.online/api/…`

## Telegram (two bots)

1. **TradeGPT** — trading assistant + tasks (token in `deploy/.env` `TELEGRAM_BOT_TOKEN`)
   - Owner chat ID: `600639327`
   - Routes via n8n → `/api/ai/query`
   - Tasks: scanner on/off, new signal, open positions, dashboard

2. **OpenClaw native bot** — this agent (token in `~/.openclaw/openclaw.json`)
   - Full file/code access in this workspace
   - `allowFrom`: owner Telegram ID only

## OpenClaw

- Config: `~/.openclaw/openclaw.json`
- Service: `systemctl --user restart openclaw-gateway.service`
- Control UI: `http://127.0.0.1:18789` (tunnel for remote)
- Model: DeftLLM `deftllm/auto` via `127.0.0.1:3001`

## n8n workflows

Import/update:
```bash
cd ~/crypto-trading && node scripts/import-n8n-workflows.js
```

Key: `tradegpt-unified-telegram.json` — inbound Telegram for TradeGPT bot

## Trade flow (short)

Scanner → signal → Telegram buttons → execute on Binance → SL/TP1 on exchange → TP1 30% → BE → TP2 40% → trail 30%
