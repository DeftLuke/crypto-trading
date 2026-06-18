# n8n Workflow Setup (Production)

Import workflows into https://n8n.deftluke.online

n8n is the **execution safety layer only** — no strategy logic.

## SSL / HTTPS

If n8n shows **"SSL not installed"**, n8n was using `http://localhost`. Fixed via `n8n/docker-compose.yml`:

```
N8N_PROTOCOL=https
N8N_HOST=n8n.deftluke.online
WEBHOOK_URL=https://n8n.deftluke.online/
```

On Kali: `cd ~/n8n && docker compose up -d`

Full guide: [docs/SSL-SETUP.md](../docs/SSL-SETUP.md)

## n8n variables

Copy from `production.env.json` (create from `production.env.example.json`):

| Variable | Production value |
|----------|------------------|
| `BACKEND_URL` | `https://api.deftluke.online` |
| `AI_GATEWAY_URL` | `https://ai.deftluke.online` |
| `OLLAMA_URL` | `https://ai.deftluke.online` |
| `AI_API_KEY` | `trading-agent-key-2024` |
| `N8N_BASE_URL` | `https://n8n.deftluke.online` |
| `N8N_API_KEY` | your n8n Public API key (Settings → API) |
| `TELEGRAM_CHAT_ID` | `600639327` |
| `RESEARCH_API_URL` | `http://research-api:8100` or production research URL |

## Workflows

| File | Webhook | Target (Phase 10) |
|------|---------|-------------------|
| `trade-execution.json` | `/webhook/trade-execute` | **`RESEARCH_API_URL/control/signal`** (replaces legacy `/api/execute`) |
| `platform-ai-chat.json` | `/webhook/platform-ai` | Research `/agent/chat` |
| `platform-events.json` | `/webhook/platform-event` | Research `/operations/event` |
| `daily-summary.json` | Schedule | Daily report workflow |
| `signal-notify.json` | `/webhook/signal-notify` | Telegram notify only |
| `ai-assistant.json` | `/webhook/ai-assistant` |
| `app-integration.json` | `/webhook/app-signal` |

## Import steps

### Option A — API (recommended)

```bash
node scripts/import-n8n-workflows.js
```

Uses `N8N_API_KEY` from `backend/.env` or `n8n/workflows/production.env.json`.

### Option B — Manual UI

1. n8n → Workflows → Import from File
2. Import all 4 JSON files
3. Settings → Variables → add production values
4. Connect Telegram credentials on notify + execution workflows
5. **Activate** each workflow

## Test

```bash
curl -H "X-N8N-API-KEY: $N8N_API_KEY" \
  "https://n8n.deftluke.online/api/v1/workflows?limit=1"

curl -X POST https://n8n.deftluke.online/webhook/ai-assistant \
  -H "Content-Type: application/json" \
  -d '{"question":"Summarize my trading performance"}'

curl https://api.deftluke.online/api/health
curl https://ai.deftluke.online/health
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Webhook 404 | Activate workflow in n8n |
| Backend unreachable | Check api.deftluke.online + Windows backend running |
| AI no response | https://ai.deftluke.online/health |
| 503 on domain | Only one cloudflared on Kali — see docs/CLOUDFLARE-TUNNEL-FIX.md |
