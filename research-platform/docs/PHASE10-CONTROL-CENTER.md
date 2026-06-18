# Phase 10 — Enterprise Control Center & Production Deployment

## Overview

Phase 10 transforms the platform into a production-grade institutional trading ecosystem with a unified **Enterprise Control Center** — every service visible, controllable, monitored, and auditable.

## Architecture

```
Analytics Dashboard (Control Center)
        ↓
Control Center API (/control/*)
        ↓
┌───────────────────────────────────────────────────────┐
│ Service Registry │ Exchange Manager │ Trading Pipeline │
│ Trading Journal  │ Audit Logger     │ Emergency Ctrl   │
└───────────────────────────────────────────────────────┘
        ↓
Phases 1–9 (Paper, Live, Memory, Agent, Operations, n8n)
```

## Trading Pipeline (replaces legacy n8n → /api/execute)

All signals flow through `POST /control/signal`:

```
Signal → Auto Trading ON? → Manual Approval? → Demo/Live Engine → Journal + Telegram
```

### Modes

| Setting | Behavior |
|---------|----------|
| `CONTROL_AUTO_TRADING=false` | Notify only, no execution |
| `CONTROL_MANUAL_APPROVAL=true` | Create pending approval → passcode → execute |
| `CONTROL_TRADING_MODE=demo` | Route to Paper Trading (Phase 7) |
| `CONTROL_TRADING_MODE=live` | Route to Live Trading (Phase 8) |

### Approval Flow

1. Signal received → pending approval created
2. Telegram notification with approval ID
3. User POST `/control/approve` with `passcode` (default `8888` via `TRADE_APPROVAL_PASSCODE`)
4. Trade executed through pipeline

## Multi-Exchange Infrastructure

Pluggable adapters in `app/control_center/exchanges/`:

- Binance, Bybit, OKX, Hyperliquid
- Add new exchange: implement `TradingExchangeAdapter` + register in factory

API: `/control/exchanges/{id}/connect|disconnect|sync|test`

## Service Control Center

Services monitored: Data Warehouse, Indicators, Backtest, Memory, Research Agent, Paper, Live, Operations, Scheduler

Actions: `POST /control/services/{id}/start|stop|restart`

## Emergency Controls

`POST /control/emergency/{action}`:

- `stop-auto-trading`, `close-all`, `kill-switch`
- `pause-research`, `pause-ai`, `disable-strategies`
- `disable-exchange` (requires `exchange_id`)

All actions audit-logged.

## n8n Migration

**Replaced:** `trade-execution.json` now calls `RESEARCH_API/control/signal` instead of legacy `BACKEND_URL/api/execute`.

Set in n8n:
```
RESEARCH_API_URL=http://research-api:8100
TELEGRAM_CHAT_ID=your_chat_id
```

Re-import: `node scripts/import-n8n-workflows.js`

## Dashboard Pages

| Route | Purpose |
|-------|---------|
| `/control` | Enterprise command center |
| `/control/audit` | Immutable audit log |
| `/control/journal` | Trading journal + timeline |
| `/live`, `/paper`, `/assistant` | Phase-specific panels |

## CI/CD

GitHub Actions: `.github/workflows/ci.yml`

- research-platform: pytest (all phases)
- analytics-dashboard: build

## Monitoring (optional stack)

Add to deploy:
- Prometheus metrics endpoint (future `/metrics`)
- Grafana dashboards
- Loki log aggregation

## Database

Migration: `supabase/migrations/016_phase10_control_center.sql`

Tables: `platform_services`, `platform_settings`, `trade_approvals`, `trade_journal`, `trade_timeline`, `platform_audit`, `platform_notifications`, `exchange_connections`

Runtime uses in-memory store (same pattern as Phases 7–9); schema ready for persistence.

## Configuration

```env
CONTROL_ENABLED=true
CONTROL_TRADING_MODE=demo
CONTROL_AUTO_TRADING=false
CONTROL_MANUAL_APPROVAL=true
CONTROL_DEFAULT_EXCHANGE=binance
TRADE_APPROVAL_PASSCODE=8888
```

## Security

- Live mode switch requires `confirm_live=true`
- Passcode required for trade approval
- RBAC schema ready (roles: admin, trader, researcher, viewer)
- JWT/2FA integration deferred — audit trail active now

## Testing

```bash
cd research-platform
pytest tests/test_phase10.py -v
```

## Deployment Checklist

1. Apply migration 016
2. Set Phase 10 env vars
3. Re-import n8n workflows
4. Set `RESEARCH_API_URL` in n8n + backend
5. Deploy research-api + analytics-dashboard
6. Verify `/control/dashboard` shows all services green
