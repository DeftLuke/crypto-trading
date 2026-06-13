# Kali Server Setup

**Production (recommended):** run the full stack on Kali 24/7 — see **[KALI-24-7.md](./KALI-24-7.md)**

Quick deploy:

```bash
git clone https://github.com/DeftLuke/crypto-trading.git ~/crypto-trading
cd ~/crypto-trading && bash scripts/kali-deploy.sh
```

## Services (all on Kali via Docker)

| Service | Local port | Public URL |
|---------|------------|------------|
| Backend + Telegram | 3001 | https://api.deftluke.online |
| Dashboard | 5173 | https://trade.deftluke.online |
| n8n | 5678 | https://n8n.deftluke.online |
| AI Gateway | 8080 | https://ai.deftluke.online |
| cloudflared | — | routes all subdomains |

No Tailscale. No Windows PC required.

## Tunnel config

File: `scripts/kali-cloudflared-config.yml` — all routes to `127.0.0.1`

```bash
bash scripts/apply-kali-tunnel.sh
```

## Verify

```bash
curl https://api.deftluke.online/api/health
curl https://ai.deftluke.online/health
curl https://n8n.deftluke.online/healthz
```

## Legacy

Old setup routed `api`/`trade` to Windows via Tailscale — **deprecated**. Do not use `WINDOWS_TAILSCALE_IP`.
