# Kali Server Setup

## Services on Kali

| Service | Local port | Public URL |
|---------|------------|------------|
| n8n | 5678 | https://n8n.deftluke.online |
| AI Gateway | 8080 | https://ai.deftluke.online |
| Ollama | 11434 | via AI gateway only |
| cloudflared | — | routes all subdomains |

## Tunnel routes (includes Windows backend)

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

Apply:

```bash
WINDOWS_TAILSCALE_IP=100.119.48.19 bash scripts/apply-kali-tunnel.sh
sudo systemctl restart cloudflared
```

## DNS (Cloudflare)

Add CNAME records pointing to your tunnel:

- `api` → `<tunnel-id>.cfargotunnel.com`
- `trade` → `<tunnel-id>.cfargotunnel.com`

(Same tunnel as `n8n` and `ai`)

## AI gateway deploy

```bash
scp -r ai-agent/gateway/* kali:~/ai-agent-gateway/
ssh kali 'AI_API_KEY=your-key BACKEND_URL=https://api.deftluke.online bash configure-ai-subdomain.sh'
```

## n8n workflows

Import from `n8n/workflows/` — see `n8n/README.md`

Workflow JSONs copied to `/tmp/n8n-workflows/` on Kali after deploy.

## Verify

```bash
curl https://n8n.deftluke.online/healthz
curl https://ai.deftluke.online/health
curl https://api.deftluke.online/api/health
```
