# Crypto Trading System

Professional SMC-based crypto futures trading platform with React dashboard, Node.js strategy engine, Supabase, n8n execution layer, Telegram alerts, and self-hosted AI on Ollama.

## Live URLs (deftluke.online)

| Service | URL |
|---------|-----|
| Dashboard | https://trade.deftluke.online |
| Backend API | https://api.deftluke.online |
| AI Agent | https://ai.deftluke.online |
| n8n | https://n8n.deftluke.online |

## Architecture

```
Scanner (Backend) → Supabase + Telegram
       ↓
User [BUY NOW] → n8n → Backend → Binance
       ↓
15/20min outcome check → Ollama lessons → Dashboard
```

- **Backend** (Windows): strategy, Binance, Telegram, risk manager
- **Frontend** (Windows): Lightweight Charts, signals, lessons panels
- **Kali server**: Ollama, AI gateway, n8n, Cloudflare tunnel
- **Supabase**: signals, trades, lessons, outcomes

## Quick start

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

### 3. Run locally (development)

```bash
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd frontend && npm run dev
```

### 4. Production domains

See [docs/DOMAINS.md](docs/DOMAINS.md) and [docs/CLOUDFLARE-TUNNEL-FIX.md](docs/CLOUDFLARE-TUNNEL-FIX.md).

On Kali, apply tunnel routes:

```bash
WINDOWS_TAILSCALE_IP=your-windows-ip bash scripts/apply-kali-tunnel.sh
```

Run frontend with host binding for tunnel:

```bash
cd frontend && npm run dev -- --host 0.0.0.0
```

### 5. n8n workflows

Import from `n8n/workflows/` into https://n8n.deftluke.online

Set variables from `n8n/workflows/production.env.json`:

- `BACKEND_URL` = `https://api.deftluke.online`
- `AI_GATEWAY_URL` = `https://ai.deftluke.online`
- `AI_API_KEY`, `TELEGRAM_CHAT_ID`

Activate all workflows.

## Project structure

```
├── backend/           Express API + strategy engine
├── frontend/          React dashboard (Vite)
├── ai-agent/          Ollama gateway for Kali
├── n8n/workflows/     Importable automation JSON
├── supabase/          SQL migrations
├── scripts/           Cloudflare tunnel configs
└── docs/              Setup guides
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
