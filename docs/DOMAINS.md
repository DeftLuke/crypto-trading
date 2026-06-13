# Production Domains — deftluke.online

## Public URLs

| Domain | Service | Where it runs |
|--------|---------|---------------|
| https://api.deftluke.online | Backend API (:3001) | **Kali or VPS Docker** |
| https://trade.deftluke.online | React dashboard | **Kali or VPS Docker** |
| https://n8n.deftluke.online | n8n workflows (:5678) | **Kali or VPS Docker** |
| https://ai.deftluke.online | AI gateway / Ollama (:8080) | **Kali or VPS Docker** |

## Architecture (production — always online)

**Option A — Kali server (free, no VPS):** see [KALI-24-7.md](./KALI-24-7.md)

**Option B — Cloud VPS:** see [VPS-DEPLOY.md](./VPS-DEPLOY.md)

```
Internet → Cloudflare HTTPS → cloudflared on Kali (or VPS) → Docker:
  api.deftluke.online    → http://127.0.0.1:3001
  trade.deftluke.online  → http://127.0.0.1:5173
  n8n.deftluke.online    → http://127.0.0.1:5678
  ai.deftluke.online     → http://127.0.0.1:8080
```

**No Tailscale. No ngrok.** Cloudflare Tunnel is free with your custom domain.

## Quick deploy

**Kali (no VPS):** `bash scripts/kali-deploy.sh` — [KALI-24-7.md](./KALI-24-7.md)

**VPS:** `docker compose --profile tunnel up -d --build` — [VPS-DEPLOY.md](./VPS-DEPLOY.md)

Stop Windows tunnel when Kali/VPS is live (one connector per tunnel).

## DNS (Cloudflare CNAME)

All subdomains → tunnel `866ccee2-ad90-40a5-b04b-f88224e6e469`:

```bash
bash scripts/setup-all-dns.sh
```

## Environment variables

Backend / `deploy/.env`:

```
PUBLIC_API_URL=https://api.deftluke.online
AI_GATEWAY_URL=http://ai-gateway:8080   # internal on VPS Docker
OLLAMA_VIA_GATEWAY=true
```

Frontend build args (set in `deploy/.env`):

```
VITE_API_URL=https://api.deftluke.online
VITE_WS_URL=wss://api.deftluke.online
```

## Verify

```bash
curl https://api.deftluke.online/api/health
curl -I https://trade.deftluke.online
curl https://n8n.deftluke.online/healthz
curl https://ai.deftluke.online/health
```

## Legacy (do not use for production)

| Old setup | Problem |
|-----------|---------|
| Windows PC + `start-windows-tunnel.bat` | Stops when PC loses power |
| Kali via Tailscale `100.110.x.x` | Requires VPN + home server online |
| `scripts/windows-cloudflared-config.yml` | Deprecated — use `deploy/` instead |

Local dev only: run `backend` + `frontend` on your PC without starting the tunnel.
