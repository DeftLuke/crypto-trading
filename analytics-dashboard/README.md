# TradeGPT Institutional Analytics Dashboard

Phase 4 — Next.js institutional trading terminal.

## Quick start

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) → redirects to `/dashboard`.

## Features

- Home dashboard with account, signals, system status, AI recommendations
- Research, backtests (Phase 3 API), strategies, signals, trades, analytics
- Risk + system monitoring
- WebSocket live updates + TanStack Query polling fallback
- Global search (⌘K), filters, CSV export, virtualized tables
- Dark institutional theme, mobile-responsive layout
- Supabase auth (email + Google) with dev fallback

## Docs

See [docs/PHASE4-ARCHITECTURE.md](./docs/PHASE4-ARCHITECTURE.md).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run test` | Vitest unit tests |
