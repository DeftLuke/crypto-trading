# Production Domains — deftluke.online

All services are reachable on your domain without Tailscale. Tailscale is only used **inside** the Cloudflare tunnel config on Kali to reach your Windows PC.

## Public URLs

| Service | URL | Runs on |
|---------|-----|---------|
| **Backend API** | https://api.deftluke.online | Windows PC :3001 |
| **Dashboard** | https://trade.deftluke.online | Windows PC :5173 |
| **AI / Ollama** | https://ai.deftluke.online | Kali :8080 (gateway → Ollama) |
| **n8n** | https://n8n.deftluke.online | Kali :5678 |

## Health checks

```bash
curl https://api.deftluke.online/api/health
curl https://ai.deftluke.online/health
curl https://n8n.deftluke.online/healthz
```

## Cloudflare tunnel (Kali only)

File: `scripts/kali-cloudflared-config.yml`

```yaml
ingress:
  - hostname: n8n.deftluke.online
    service: http://127.0.0.1:5678
  - hostname: ai.deftluke.online
    service: http://127.0.0.1:8080
  - hostname: api.deftluke.online
    service: http://WINDOWS_TAILSCALE_IP:3001
  - hostname: trade.deftluke.online
    service: http://WINDOWS_TAILSCALE_IP:5173
```

Apply on Kali:

```bash
WINDOWS_TAILSCALE_IP=100.119.48.19 bash scripts/apply-kali-tunnel.sh
sudo systemctl restart cloudflared
```

Add DNS CNAME records in Cloudflare for `api` and `trade` subdomains pointing to your tunnel (same as n8n/ai).

## Environment variables

### Backend (`backend/.env`)

```
PUBLIC_API_URL=https://api.deftluke.online
AI_GATEWAY_URL=https://ai.deftluke.online
OLLAMA_URL=https://ai.deftluke.online
OLLAMA_VIA_GATEWAY=true
```

### Frontend (`frontend/.env`)

```
VITE_API_URL=https://api.deftluke.online
VITE_WS_URL=wss://api.deftluke.online
```

### n8n variables

See `n8n/workflows/production.env.json`

### AI Gateway on Kali (systemd)

```
BACKEND_URL=https://api.deftluke.online
OLLAMA_URL=http://127.0.0.1:11434
AI_API_KEY=your-key
```

## Ollama via domain

Ollama is **not** exposed directly. All AI calls go through:

- `https://ai.deftluke.online/chat` — Q&A
- `https://ai.deftluke.online/ollama/generate` — lesson generation (X-API-Key)
- `https://ai.deftluke.online/ollama/embeddings` — vectors (X-API-Key)

## Do NOT

- Run cloudflared on Windows (causes 503 conflicts)
- Put Tailscale IPs in n8n workflows or app `.env` files
- Expose Ollama port 11434 publicly
