# Production Public Access — deftluke.online

## You do NOT need Tailscale or nginx

| Layer | What it does |
|-------|----------------|
| **Cloudflare DNS** | `*.deftluke.online` → Cloudflare edge |
| **cloudflared** (on Kali) | Tunnel HTTPS → `127.0.0.1` services |
| **Docker** | Apps bind localhost only — not exposed to raw internet |

nginx is optional. The tunnel terminates TLS at Cloudflare.

## Architecture

```
Anyone on any network
        ↓ HTTPS
Cloudflare (certificate + DDoS)
        ↓ encrypted tunnel
cloudflared on Kali (systemd, 24/7)
        ↓ HTTP localhost
┌───────────────────────────────────────┐
│ api.deftluke.online    → :3002 backend│
│ trade.deftluke.online  → :5173 frontend│
│ terminal.deftluke.online → :3000 dash │
│ n8n.deftluke.online    → :5678 n8n   │
│ ai.deftluke.online     → :8080 AI    │
└───────────────────────────────────────┘
```

## One-time setup on Kali

```bash
cd ~/crypto-trading
bash scripts/production-kali.sh
```

This enables:
- `cloudflared` systemd (auto-start on reboot)
- Docker `restart: always` on all services
- `INTERNAL_API_SECRET` for protected trade execution
- CORS locked to your domains

## If sites only work with Tailscale

| Cause | Fix |
|-------|-----|
| **Windows cloudflared still running** | `taskkill /F /IM cloudflared.exe` — only ONE connector per tunnel |
| **Cloudflare Access login wall** | Zero Trust → Access → Applications → delete or add Bypass for `*.deftluke.online` |
| **Using Tailscale IP instead of domain** | Use `https://trade.deftluke.online` not `100.x.x.x` |
| **cloudflared not running on Kali** | `sudo systemctl status cloudflared` |
| **Services down** | `docker ps` + `curl http://127.0.0.1:3002/api/health` |

## Security (real funds)

### Already protected
- Binance keys stored encrypted / RSA file mount — never in API responses
- `/api/execute` requires internal secret OR signed-in user OR localhost
- Rate limiting on public API
- CORS restricted to `trade.deftluke.online` + `terminal.deftluke.online`
- Services listen on `127.0.0.1` only — not directly reachable from internet
- Telegram ingestion requires `EXTERNAL_SIGNAL_INGESTION_KEY`

### Recommended in Cloudflare dashboard
1. **SSL/TLS** → Full (strict)
2. **Security** → WAF → enable OWASP rules
3. **Zero Trust → Access** → do NOT protect public trade dashboard unless you want login
4. **Bots** → challenge suspicious traffic on `api.deftluke.online`

### env vars (deploy/.env)
```env
INTERNAL_API_SECRET=<random 64-char hex>
CORS_ORIGINS=https://trade.deftluke.online,https://terminal.deftluke.online
EXTERNAL_SIGNAL_INGESTION_KEY=<random>
CONTROL_AUTO_TRADING=true
CONTROL_MANUAL_APPROVAL=false
```

Never commit `.env` or `deploy/keys/` to git.

## 24/7 monitoring

```bash
sudo systemctl status cloudflared
docker ps
curl -s https://api.deftluke.online/api/health
```

Re-run after code updates:
```bash
bash ~/crypto-trading/scripts/production-kali.sh
```

## Verify from phone (Wi‑Fi OFF, no VPN)

Open:
- https://trade.deftluke.online
- https://api.deftluke.online/api/health

Should return 200 without Tailscale.
