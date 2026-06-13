# Kali 24/7 — No VPS, No Tailscale, No ngrok

Run **everything on your Kali server** with **Cloudflare Tunnel** (free, stable URLs you already have).

## Why not ngrok?

| | Cloudflare Tunnel (you have this) | ngrok free |
|--|-----------------------------------|------------|
| Custom domain | ✅ `api.deftluke.online` | ❌ random URL unless paid |
| Cost | **Free** | Paid for stable domain |
| 24/7 | ✅ with Kali always on | ✅ but URL changes on free tier |
| SSL | ✅ automatic | ✅ |

**SSH** lets you manage Kali remotely — it does **not** make your app public. Cloudflare Tunnel does that (already set up).

## Why not Tailscale?

Tailscale only connects your devices privately. If Windows is off, Kali cannot reach it. **All services on Kali = no VPN needed.**

## Architecture

```
Internet → Cloudflare HTTPS (deftluke.online)
              ↓
         cloudflared (systemd on Kali)
              ↓
         127.0.0.1 ports (Docker):
           :3001  backend + Telegram bot + scanner
           :5173  dashboard
           :5678  n8n
           :8080  AI gateway + Ollama
```

Windows PC can stay **off**. Trading continues on Kali.

---

## One-time setup on Kali

### 1. Copy tunnel credentials (if not already on Kali)

From Windows, copy to Kali:

```
C:\Users\<you>\.cloudflared\866ccee2-ad90-40a5-b04b-f88224e6e469.json
→ /home/kali/.cloudflared/866ccee2-ad90-40a5-b04b-f88224e6e469.json
```

```bash
# On Kali — install cloudflared if missing
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb
sudo dpkg -i /tmp/cloudflared.deb
sudo cloudflared service install
```

### 2. Clone and deploy

```bash
git clone https://github.com/DeftLuke/crypto-trading.git ~/crypto-trading
cd ~/crypto-trading
bash scripts/kali-deploy.sh
```

First run creates `deploy/.env` — edit with your secrets:

```bash
nano deploy/.env
# SUPABASE_*, TELEGRAM_*, BINANCE_*, AI_API_KEY, N8N_API_KEY
bash scripts/kali-deploy.sh   # run again
```

### 3. Stop Windows tunnel

Only **one** cloudflared connector allowed:

```bat
taskkill /F /IM cloudflared.exe
```

Do not run `start-windows-tunnel.bat` anymore.

---

## After power outage

If **only Windows** lost power → Kali keeps running ✅

If **Kali also** lost power (same breaker):

1. Kali boots → `crypto-trading.service` starts Docker stack
2. `cloudflared` starts → public URLs return in ~1–2 min

**Optional:** small UPS (~$40) on Kali router + server for short outages.

---

## Daily commands (SSH into Kali)

```bash
cd ~/crypto-trading/deploy

docker compose ps                 # status
docker compose logs -f backend    # live logs
docker compose restart backend    # restart bot
sudo systemctl status cloudflared # tunnel status
```

Update after code changes:

```bash
cd ~/crypto-trading && git pull
cd deploy && docker compose up -d --build
```

---

## Verify public access

```bash
curl https://api.deftluke.online/api/health
curl https://ai.deftluke.online/health
curl -I https://trade.deftluke.online
curl https://n8n.deftluke.online/healthz
```

Send **Hi** to Telegram — should work with Windows off.

---

## Import n8n workflows

```bash
cd ~/crypto-trading
# Copy backend/.env secrets or use deploy/.env
node scripts/import-n8n-workflows.js
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| 503 on all domains | Two tunnels running — stop Windows cloudflared |
| Port already in use | `sudo systemctl stop ai-agent ollama` then redeploy |
| Backend not starting | `docker compose logs backend` — check `.env` |
| AI slow | Normal on CPU — uses `mistral:7b` in Docker |

---

## Files

| File | Purpose |
|------|---------|
| `scripts/kali-deploy.sh` | Full one-command deploy |
| `scripts/kali-cloudflared-config.yml` | Tunnel → localhost (no Tailscale) |
| `scripts/apply-kali-tunnel.sh` | Apply tunnel config + restart |
| `deploy/docker-compose.yml` | All services in Docker |

Alternative: cloud VPS — see [VPS-DEPLOY.md](./VPS-DEPLOY.md) if you later want datacenter uptime.
