# n8n Workflow Setup (Production)

Import workflows into https://n8n.deftluke.online

n8n is the **execution safety layer only** — no strategy logic.

## n8n variables

Copy from `production.env.json`:

| Variable | Production value |
|----------|------------------|
| `BACKEND_URL` | `https://api.deftluke.online` |
| `AI_GATEWAY_URL` | `https://ai.deftluke.online` |
| `OLLAMA_URL` | `https://ai.deftluke.online` |
| `AI_API_KEY` | your gateway key |
| `TELEGRAM_CHAT_ID` | your chat ID |

## Workflows

| File | Webhook |
|------|---------|
| `trade-execution.json` | `/webhook/trade-execute` |
| `signal-notify.json` | `/webhook/signal-notify` |
| `ai-assistant.json` | `/webhook/ai-assistant` |
| `app-integration.json` | `/webhook/app-signal` |

## Import steps

1. n8n → Workflows → Import from File
2. Import all 4 JSON files
3. Settings → Variables → add production values
4. Connect Telegram credentials on notify + execution workflows
5. **Activate** each workflow

## Test

```bash
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
