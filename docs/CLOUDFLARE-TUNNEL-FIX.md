# Cloudflare Tunnel — Production on VPS

## Current setup (recommended)

| Component | Location |
|-----------|----------|
| DNS | Cloudflare CNAME → tunnel |
| Tunnel connector | **VPS** (`deploy/docker-compose.yml` → `cloudflared` service) |
| Backend, UI, n8n, AI | **Same VPS** — all Docker, no Tailscale |

See **[VPS-DEPLOY.md](./VPS-DEPLOY.md)** for full instructions.

## Why VPS instead of Windows + Kali

| Old problem | VPS solution |
|-------------|--------------|
| Power outage on PC → everything offline | VPS runs 24/7 in datacenter |
| Tailscale between Windows ↔ Kali | All services on one Docker network |
| Two cloudflared connectors → 503 | Single connector on VPS |

## Cloudflare public hostnames (tunnel dashboard)

Configure these service URLs when using `CLOUDFLARE_TUNNEL_TOKEN`:

```
api.deftluke.online    → http://backend:3001
trade.deftluke.online  → http://frontend:80
n8n.deftluke.online    → http://n8n:5678
ai.deftluke.online     → http://ai-gateway:8080
```

## Rules

- **One** cloudflared connector per tunnel
- Stop Windows `start-windows-tunnel.bat` when VPS is live
- Stop Kali `cloudflared` service
- n8n `WEBHOOK_URL` = `https://n8n.deftluke.online/` (not localhost)

## Test

```
https://api.deftluke.online/api/health
https://trade.deftluke.online
https://n8n.deftluke.online
https://ai.deftluke.online/health
```

## Legacy configs (dev / deprecated)

- `scripts/windows-cloudflared-config.yml` — Windows + Tailscale to Kali (deprecated)
- `scripts/kali-cloudflared-config.yml` — Kali tunnel to Windows (deprecated)

See also: [DOMAINS.md](./DOMAINS.md) | [SSL-SETUP.md](./SSL-SETUP.md)
