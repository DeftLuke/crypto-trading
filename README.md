# Crypto Trading System

Professional SMC-based crypto futures trading platform with React dashboard, Node.js strategy engine, Supabase, n8n execution layer, Telegram alerts, and self-hosted AI on Ollama.

## Live URLs (deftluke.online)

| Service | URL |
|---------|-----|
| Dashboard | https://trade.deftluke.online |
| Backend API | https://api.deftluke.online |
| AI Agent | https://ai.deftluke.online |
| n8n | https://n8n.deftluke.online |

## Architecture (production — always online)

```
Internet → Cloudflare → VPS Docker (24/7):
  backend + scanner + Telegram bot
  frontend dashboard
  n8n workflows
  Ollama + AI gateway
       ↓
Supabase (cloud) + Binance API + Telegram
```

**No Tailscale. No Windows PC required.** Deploy on your **Kali server** (free) or a cloud VPS.

👉 **[docs/KALI-24-7.md](docs/KALI-24-7.md)** — run 24/7 on Kali + Cloudflare (no VPS, no ngrok)  
👉 **[docs/VPS-DEPLOY.md](docs/VPS-DEPLOY.md)** — optional cloud datacenter hosting

## Quick start (local dev only)

### 1. Clone and install

```bash
git clone https://github.com/DeftLuke/crypto-trading.git
cd crypto-trading

cd backend && npm install && cp .env.example .env
cd ../frontend && npm install && cp .env.example .env
```

Fill in `backend/.env` with Supabase, Telegram, Binance keys.

### 2. Database

Run SQL migrations in Supabase SQL Editor:

- `supabase/migrations/001_initial_schema.sql`
- `supabase/migrations/002_signal_outcomes.sql`
- `supabase/migrations/003_agent_assistant.sql`

### 3. Run locally

```bash
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd frontend && npm run dev
```

### 4. Production (Kali 24/7 — recommended, no VPS)

On your Kali server:

```bash
git clone https://github.com/DeftLuke/crypto-trading.git ~/crypto-trading
cd ~/crypto-trading
bash scripts/kali-deploy.sh
```

Uses **Cloudflare Tunnel** (free stable URLs — not ngrok). Stop Windows tunnel when Kali is live.

See [docs/KALI-24-7.md](docs/KALI-24-7.md).

### 4b. Production (cloud VPS — optional)

```bash
cd deploy && cp .env.example .env
docker compose --profile tunnel up -d --build
```

See [docs/VPS-DEPLOY.md](docs/VPS-DEPLOY.md).

### 5. n8n workflows

```bash
node scripts/import-n8n-workflows.js
```

Set variables from `n8n/workflows/production.env.json` in n8n UI.

## Project structure

```
├── backend/           Express API + strategy engine + Telegram bot
├── frontend/          React dashboard (Vite)
├── deploy/            Production Docker stack (VPS 24/7)
├── ai-agent/          Ollama gateway
├── n8n/workflows/     Importable automation JSON
├── supabase/          SQL migrations
├── scripts/           VPS setup + workflow import
└── docs/              Setup guides (start with VPS-DEPLOY.md)
```

## Strategy

Multi-timeframe SMC: 1H trend → 30M confirm → 15M OB → 5M/3M entry

- EMA100 filter, RSI zones, BOS/CHoCH/OB/liquidity sweep
- Min confidence 70%, 1% risk per trade, 3% daily max loss
- Signal outcome tracking at 15/20 minutes + AI lessons

## Telegram commands

`/start` `/stats` `/wins` `/losses` `/skipped` `/ask`

High-confidence signals include **BUY NOW** / **SKIP** buttons.

## Docs

- [PLANNING.md](docs/PLANNING.md) — full system design
- [DOMAINS.md](docs/DOMAINS.md) — production URL reference
- [AI-SETUP.md](docs/AI-SETUP.md) — Ollama + AI gateway
- [KALI-SETUP.md](docs/KALI-SETUP.md) — server setup

## License

Private — DeftLuke
