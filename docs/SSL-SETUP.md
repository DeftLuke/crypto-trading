# SSL / HTTPS — deftluke.online

You do **not** install SSL certificates on Kali or Windows manually. **Cloudflare** provides HTTPS for all tunnel subdomains.

## How it works

```
Browser → HTTPS (Cloudflare cert) → cloudflared tunnel → HTTP localhost on server
```

Certificate on `n8n.deftluke.online` is issued by Cloudflare (Google Trust Services). Valid as long as DNS points to the tunnel.

## Fix: n8n shows "SSL not installed"

n8n was configured with `http://localhost` — it must use your public HTTPS URL.

**Fixed settings** in `/home/kali/n8n/docker-compose.yml`:

```yaml
N8N_HOST: n8n.deftluke.online
N8N_PROTOCOL: https
N8N_EDITOR_BASE_URL: https://n8n.deftluke.online/
WEBHOOK_URL: https://n8n.deftluke.online/
N8N_SECURE_COOKIE: "true"
N8N_PROXY_HOPS: "1"
```

Restart n8n on Kali:

```bash
cd ~/n8n && docker compose up -d
```

## Cloudflare dashboard checks

1. **DNS** → `n8n` CNAME → `<tunnel-id>.cfargotunnel.com` (proxied ☁️ orange)
2. **SSL/TLS** → Overview → mode: **Full** or **Full (strict)**
3. **SSL/TLS** → Edge Certificates → Always Use HTTPS: **On**

## Missing subdomains (api, trade)

DNS CNAME records are registered via:

```bash
bash scripts/setup-all-dns.sh
```

Tunnel runs on **Windows** (not Kali) — see [CLOUDFLARE-TUNNEL-FIX.md](./CLOUDFLARE-TUNNEL-FIX.md).

## Verify SSL

```bash
curl -I https://n8n.deftluke.online/healthz
# HTTP/1.1 200 OK, Server: cloudflare

curl -H "X-N8N-API-KEY: your-key" \
  "https://n8n.deftluke.online/api/v1/workflows?limit=1"
```

In browser: open https://n8n.deftluke.online — padlock should show valid certificate for `deftluke.online`.

## Do NOT

- Install certbot/Let's Encrypt on Kali for tunnel subdomains (not needed)
- Set `N8N_PROTOCOL=http` or `WEBHOOK_URL=http://localhost` in production
- Run cloudflared on Windows (causes 503/502 conflicts)
