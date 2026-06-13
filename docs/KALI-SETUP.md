# Kali Server Setup — Completed Steps & Manual Actions

## ✅ Done on your Kali server (100.110.210.103)

| Task | Status |
|------|--------|
| Ollama running | ✅ Active on `0.0.0.0:11434` |
| `qwen2.5:7b-instruct` | ✅ Downloaded |
| `nomic-embed-text` | ✅ Downloaded + tested |
| `mistral:7b` fallback | ✅ Working (qwen2.5 segfaults on server — auto-fallback enabled) |
| n8n Docker | ✅ Running on port 5678 |
| Cloudflared tunnel token | ✅ Updated to `n8n-tunnel` |
| n8n workflow JSONs | ✅ Copied to `/tmp/n8n-workflows/` on Kali |

## ⚠️ YOU must do these 2 steps manually

### 1. Run database migration (Supabase SQL Editor)

Open Supabase → SQL Editor → paste and run:

`supabase/migrations/002_signal_outcomes.sql`

This adds:
- `signal_outcomes` table (15/20 min checks)
- `user_action`, `final_outcome`, `win_probability` on signals
- `lesson_type` on trade_lessons (skipped / executed / hypothetical)

### 2. Fix Cloudflare public hostname (Error 1033)

Tunnel connector is **UP** but route may be missing:

1. Go to **Cloudflare Zero Trust** → **Networks** → **Tunnels** → **n8n-tunnel**
2. **Public Hostname** tab → Add/verify:
   - Subdomain: `n8n`
   - Domain: `deftluke.online`
   - Service: `http://localhost:5678`
3. Save → wait 1–2 minutes → test https://n8n.deftluke.online

### 3. Import n8n workflows

On Kali, files are at `/tmp/n8n-workflows/`:

- `trade-execution.json`
- `signal-notify.json`
- `ai-assistant.json`
- `app-integration.json`

In n8n UI → Workflows → Import → Activate each workflow.

Set n8n environment variables:
```
BACKEND_URL=http://YOUR_PC_IP:3001
OLLAMA_URL=http://127.0.0.1:11434
```

## Backend `.env` (already updated)

```
OLLAMA_URL=http://100.110.210.103:11434
N8N_SIGNAL_WEBHOOK_URL=https://n8n.deftluke.online/webhook/signal-notify
```

Restart backend after migration: `cd backend && npm run dev`

## New features

### Signal outcome tracking
- Every signal → checked at **15 min** and **20 min**
- Calculates: win/loss, TP1/SL hit, win probability %
- Sends Telegram review message at 20 min
- Generates AI lesson via Ollama

### Dashboard
- **Skipped Trade Lessons** — signals you skipped + what would have happened
- **Real Trade Lessons** — executed trades + outcomes

### API endpoints
- `GET /api/lessons/skipped`
- `GET /api/lessons/executed`
- `GET /api/lessons/stats`
- `GET /api/signals/:id/outcomes`
- `GET /api/ai/health`
