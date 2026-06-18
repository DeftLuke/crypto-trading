# Phase 4 — Institutional Analytics Dashboard

Next.js institutional trading terminal integrating Phase 1–3 research stack with live trading APIs.

## Stack

- **Next.js 16** (App Router), React 19, TypeScript
- **Tailwind CSS v4**, Radix UI primitives (shadcn-style)
- **TanStack Query** — API caching + polling fallback
- **Zustand** — auth, strategies, trades, signals, analytics, system, settings, notifications
- **Recharts** — equity, drawdown, session, SMC charts
- **TradingView** — optional (`NEXT_PUBLIC_TV_LIBRARY`)
- **Supabase Auth** — email + Google OAuth

## Architecture

```
analytics-dashboard/
├── src/app/
│   ├── (dashboard)/          # Shell: sidebar + top nav + WebSocket
│   │   ├── dashboard/        # Home overview
│   │   ├── research/         # Research pipeline
│   │   ├── backtests/        # Phase 3 backtest jobs
│   │   ├── strategies/       # Strategy explorer + detail
│   │   ├── signals/          # Live signals + chart
│   │   ├── trades/           # Trade analytics + positions
│   │   ├── analytics/        # Equity, sessions, symbols, SMC, ranking, AI
│   │   ├── risk/             # Risk dashboard
│   │   ├── system/           # Health monitoring
│   │   └── settings/         # Theme + account
│   └── login/
├── src/components/           # UI, layout, charts, shared
├── src/hooks/                # useQueries, useWebSocket, useAuthInit
├── src/services/             # researchApi, tradingApi, mockData
├── src/store/                # Zustand stores
└── src/types/                # Shared TypeScript types
```

## API Integration

| Client | Proxy | Backend |
|--------|-------|---------|
| `/api/research/*` | `next.config.ts` rewrite | Research platform `:8100` |
| `/api/trading/*` | rewrite | Node backend `:3001/api/*` |
| WebSocket | `NEXT_PUBLIC_WS_URL` | `ws://localhost:3001/ws` |

Primary: WebSocket for signals/scanner. Fallback: TanStack Query polling (10–30s).

## State Management

| Store | Purpose |
|-------|---------|
| `authStore` | User, role, RBAC (`hasRole`) |
| `strategyStore` | Strategies, rankings |
| `tradeStore` | Trade cache (WebSocket updates) |
| `signalStore` | Live signal prepend |
| `analyticsStore` | Filtered analytics state |
| `systemStore` | WS connection, health |
| `settingsStore` | Theme, global filters |
| `notificationStore` | Toast + notification center |

## Roles

- **admin** — all routes including `/system`
- **researcher** — `/research`
- **trader** — trading pages
- **viewer** — read-only (enforced in nav; extend middleware as needed)

## Development

```bash
cd analytics-dashboard
cp .env.example .env.local
npm install
npm run dev    # http://localhost:3000
```

Ensure backends are running:

- Research: `research-platform` on `:8100`
- Trading: `backend` on `:3001`

## Production

```bash
npm run build
npm start
```

Set env vars for Supabase, API URLs, and optional TradingView library path.

## Future Phases

- **Phase 5** — Qdrant memory hooks in `analyticsStore` + AI context
- **Phase 6** — Replace `mockData.ts` AI insights with agent API
- **Phase 7/8** — Wire position actions in `/trades/positions`
- **Phase 9** — n8n webhook notifications in `notificationStore`

## Tests

```bash
npm run test
```

Vitest unit tests for utils and auth store RBAC.
