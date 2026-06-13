# Cloudflare Tunnel — Domain Setup

## Architecture

One cloudflared connector on **Kali Linux** routes all subdomains:

| Subdomain | Target |
|-----------|--------|
| `api.deftluke.online` | Windows backend :3001 (via Tailscale, internal only) |
| `trade.deftluke.online` | Windows frontend :5173 (via Tailscale, internal only) |
| `ai.deftluke.online` | Kali AI gateway :8080 |
| `n8n.deftluke.online` | Kali n8n :5678 |

## Apply tunnel config

On Kali:

```bash
cd ~/crypto-trading   # or copy scripts/ from repo
WINDOWS_TAILSCALE_IP=$(# run tailscale ip -4 on Windows)
bash scripts/apply-kali-tunnel.sh
```

Config file: `scripts/kali-cloudflared-config.yml`

## Fix 503 errors

503 happens when **two** cloudflared connectors use the same tunnel.

**Do not run cloudflared on Windows.** Run as Admin once:

```
scripts\fix-cloudflared-windows.bat
```

## Test in browser

- https://api.deftluke.online/api/health
- https://trade.deftluke.online
- https://ai.deftluke.online/health
- https://n8n.deftluke.online/healthz

## DNS

In Cloudflare DNS, add CNAME records for `api` and `trade` (if not already):

- `api` → tunnel UUID `.cfargotunnel.com`
- `trade` → tunnel UUID `.cfargotunnel.com`

Same tunnel as `n8n` and `ai`.

## Requirements on Windows

1. Backend running: `cd backend && npm run dev`
2. Frontend running: `cd frontend && npm run dev -- --host`
3. Tailscale connected (for Kali tunnel to reach your PC)

See [DOMAINS.md](./DOMAINS.md) for full production URL reference.
