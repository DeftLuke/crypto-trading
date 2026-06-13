# Production VPS Deployment — Always Online (No Tailscale, No Windows PC)

When your home PC loses power, the trading bot stops if everything runs locally. **Move the full stack to one cloud VPS** so it runs 24/7 with auto-restart.

## What moves to the VPS

| Service | Was running on | Runs on VPS |
|---------|----------------|-------------|
| Backend + scanner + Telegram bot | Windows | Docker `backend` |
| Dashboard | Windows | Docker `frontend` |
| n8n workflows | Kali + Tailscale | Docker `n8n` |
| AI gateway + Ollama | Kali + Tailscale | Docker `ai-gateway` + `ollama` |
| Cloudflare tunnel | Windows | Docker `cloudflared` |

**Supabase** stays in the cloud (already independent).

## Architecture

```
Internet
   ↓
Cloudflare HTTPS (api / trade / n8n / ai.deftluke.online)
   ↓
cloudflared container (on VPS)
   ↓
Docker network (all localhost — NO Tailscale):
  backend:3001  frontend:80  n8n:5678  ai-gateway:8080  ollama:11434
```

Your Windows PC becomes **optional** — only for editing code. Trading continues when it is off.

---

## Step 1 — Get a VPS

Recommended (always-on, cheap):

| Provider | Plan | RAM | ~Cost |
|----------|------|-----|-------|
| [Hetzner CX32](https://www.hetzner.com/cloud) | 4 vCPU | 8 GB | ~€6/mo |
| [DigitalOcean](https://www.digitalocean.com/) | Basic | 4 GB | ~$24/mo |
| [Oracle Cloud](https://www.oracle.com/cloud/free/) | Free tier | 4–24 GB | Free |

- **Minimum:** 4 GB RAM (use `mistral:7b` only)
- **Recommended:** 8 GB RAM (Ollama + n8n + backend together)

OS: **Ubuntu 22.04 or 24.04**

---

## Step 2 — Cloudflare tunnel (move connector to VPS)

You already have tunnel `866ccee2-ad90-40a5-b04b-f88224e6e469`.

### Option A — Tunnel token (easiest)

1. Cloudflare Zero Trust → **Networks** → **Tunnels** → your tunnel → **Configure**
2. **Public Hostnames** — set each route to Docker service names:

| Public hostname | Service URL |
|-----------------|-------------|
| `api.deftluke.online` | `http://backend:3001` |
| `trade.deftluke.online` | `http://frontend:80` |
| `n8n.deftluke.online` | `http://n8n:5678` |
| `ai.deftluke.online` | `http://ai-gateway:8080` |

3. Copy the **Docker install token** → paste into `deploy/.env` as `CLOUDFLARE_TUNNEL_TOKEN`

### Option B — Config file

Use `deploy/cloudflared-config.yml` and mount credentials (see `deploy/docker-compose.yml` comments).

### Stop old connectors

**Only one** cloudflared per tunnel:

```bat
REM Windows — stop local tunnel
taskkill /F /IM cloudflared.exe
```

```bash
# Kali — stop if running
sudo systemctl stop cloudflared
sudo systemctl disable cloudflared
```

---

## Step 3 — Deploy on VPS

```bash
# SSH into VPS
ssh root@YOUR_VPS_IP

# Install Docker + clone
git clone https://github.com/DeftLuke/crypto-trading.git
cd crypto-trading/deploy
cp .env.example .env
nano .env   # fill secrets (see below)
```

Copy secrets from your old `backend/.env`:

- `SUPABASE_*`, `TELEGRAM_*`, `BINANCE_*`, `AI_API_KEY`, `N8N_API_KEY`
- `CLOUDFLARE_TUNNEL_TOKEN` (new, from step 2)

Start everything:

```bash
docker compose up -d --build
```

First start pulls Ollama models (~4 GB) — can take 10–20 minutes.

---

## Step 4 — Verify

```bash
docker compose ps          # all services "running"
docker compose logs -f backend

curl https://api.deftluke.online/api/health
curl https://ai.deftluke.online/health
curl -I https://trade.deftluke.online
curl https://n8n.deftluke.online/healthz
```

Send **Hi** to your Telegram bot — should reply even with Windows PC off.

---

## Step 5 — n8n workflows

Import workflows once (from your PC or VPS):

```bash
# On VPS after stack is up
cd crypto-trading
node scripts/import-n8n-workflows.js
```

Set n8n variables (`BACKEND_URL`, `AI_GATEWAY_URL`, `TELEGRAM_CHAT_ID`) in n8n UI.

---

## Daily operations

```bash
cd ~/crypto-trading/deploy

docker compose ps              # status
docker compose logs -f backend # live logs
docker compose restart backend # restart one service
docker compose pull && docker compose up -d --build  # update after git pull
```

All containers use `restart: always` — VPS reboot → stack auto-starts.

---

## VPS sizing & AI models

Default models in `deploy/.env`:

```
OLLAMA_MODEL=mistral:7b
OLLAMA_FALLBACK_MODEL=mistral:7b
```

On 4 GB VPS, avoid `qwen2.5:7b` (uses more RAM). On 8 GB+ you can try larger models.

---

## Local development (optional)

Your PC is only for coding:

```bash
cd backend && npm run dev
cd frontend && npm run dev
```

Do **not** run `start-windows-tunnel.bat` while VPS tunnel is active.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| 503 on all domains | Two cloudflared connectors — stop Windows/Kali tunnel |
| AI 502 / timeout | `docker compose logs ollama` — wait for model pull |
| Telegram silent | `docker compose logs backend` — check `TELEGRAM_BOT_TOKEN` |
| n8n webhooks 404 | Re-import workflows; check `WEBHOOK_URL` in n8n container |

---

## Files

| File | Purpose |
|------|---------|
| `deploy/docker-compose.yml` | Full production stack |
| `deploy/.env.example` | Secrets template |
| `deploy/cloudflared-config.yml` | Tunnel routes (config-file mode) |
| `scripts/vps-setup.sh` | Automated first-time setup |

See also: [DOMAINS.md](./DOMAINS.md)
