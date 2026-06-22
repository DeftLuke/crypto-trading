# Trade Execution Audit Layer

Independent audit layer wrapping the existing execution engine — no signal logic changes.

## Migration

Apply on Supabase:

```bash
# supabase/migrations/024_trade_execution_audit.sql
```

Creates:

| Table | Purpose |
|-------|---------|
| `trade_execution_events` | Append-only lifecycle log |
| `trade_partial_closes` | TP1/TP2/runner legs with realized PnL |
| `trade_performance` | Net PnL, win/loss, ROI per trade |
| `trade_learning_dataset` | AI export on close |

Extends `trades` with: `exchange`, `lifecycle_stage`, `exchange_qty`, `db_exchange_sync_ok`, `protection_verified_at`, `risk_percentage`.

## APIs

| Endpoint | Description |
|----------|-------------|
| `GET /api/trades/home-dashboard` | Today + 7-day table + open audit |
| `GET /api/trades/today?day=YYYY-MM-DD` | Single day stats |
| `GET /api/trades/today?days=7` | Daily table |
| `GET /api/trades/performance` | Filter by source, symbol, date |
| `GET /api/trades/open/audit` | Open positions + lifecycle counts |
| `GET /api/trades/:id/lifecycle` | Events + partials + flow |

## Close policy

`reconcileFlatExchangeTrade` no longer closes DB until:

1. Exchange qty = 0
2. Partial legs reconciled (if TP1/TP2 hit)

Desynced closed trades (DB closed, exchange open) are **reopened** automatically by position monitor.

## Homepage

`trade.deftluke.online` Home → daily performance table + lifecycle pipeline + open audit cards.

## Deploy

1. Apply migration 024
2. Restart backend (`scripts/run-backend-recovery.sh`)
3. Rebuild frontend for HomePage UI
