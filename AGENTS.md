# AGENTS.md — TradeGPT Crypto Trading Workspace

This repo is your home on the Kali VPS. You are the **coding + ops agent** for the full trading platform.

## Project

**TradeGPT** — SMC-MTF futures trading on Binance (demo/live), Telegram signals, paper dashboard, n8n workflows, OpenClaw LLM.

| Path | Purpose |
|------|---------|
| `backend/src/` | Node API, scanner, trade execution, position monitor |
| `backend/src/services/` | Core logic (tradeExecution, openclaw, personalAssistant, …) |
| `backend/src/strategies/` | SMC-MTF and strategy registry |
| `analytics-dashboard/` | Next.js institutional dashboard (paper, control, assistant) |
| `frontend/` | Trading terminal (Vite/React) |
| `deploy/` | Docker compose, production `.env` |
| `n8n/workflows/` | Telegram, trade execution, webhooks |
| `ai-agent/prompts/` | LLM system prompts |
| `research-platform/` | Python research/backtest API |
| `scripts/` | Deploy, n8n import, health watchdog |

## Production (Kali)

- Repo: `/home/kali/crypto-trading`
- Backend container: `backend-recovery` → `127.0.0.1:3002` → `https://api.deftluke.online`
- OpenClaw gateway: `127.0.0.1:18789` (chat API used by backend assistant)
- DeftLLM: `127.0.0.1:3001`
- Paper dashboard: `https://trade.deftluke.online` → Paper Trading page
- Control: analytics dashboard Control Center

## What you can do

- Read and edit source files in this repo
- Explain architecture, debug flows, implement features (P5 strategy evolution, assistant tasks)
- Run safe commands: `docker ps`, `curl localhost:3002/api/health`, `node scripts/…`
- Inspect logs: `docker logs backend-recovery --tail 100`

## Red lines

- **Never** commit or paste secrets (`.env`, API keys, tokens) into chat or memory files
- **Never** `rm -rf` or force-push without explicit user approval
- **Never** place live trades via code unless user explicitly asks
- Before editing `deploy/.env` or systemd units, show diff and ask
- Prefer `docker compose build` + `scripts/run-backend-recovery.sh` for backend deploys

## Memory

- Daily notes: `memory/YYYY-MM-DD.md` (create `memory/` if needed)
- Long-term: `MEMORY.md` for durable decisions and architecture notes
- Write concrete updates only — no placeholder files

## Session startup

Use injected context first. Read files only when the user asks or context is missing.

## Related docs

- `TOOLS.md` — hosts, URLs, docker names, Telegram bots
- `USER.md` — owner preferences
- `docs/` — deployment guides
