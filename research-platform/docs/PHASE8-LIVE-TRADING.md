# Phase 8 — Institutional Live Trading Engine

Production-grade live execution layer for cryptocurrency futures. Strategy generation remains in Phases 2 and 6; Phase 8 handles **risk → execution → exchange connectivity** only.

## Architecture

```
Strategy Signals (Phase 2 / Phase 6 / Dashboard)
        ↓
Strategy Authorization Gate (paper validation required)
        ↓
Risk Engine (highest priority)
        ↓
Position Sizing → Order Executor → CCXT Binance Futures
        ↓
Position Monitor + Trailing Stops
        ↓
Trade Recording → Memory Layer (Phase 5) + AI Agent (Phase 6)
```

### Module Layout

| Path | Responsibility |
|------|----------------|
| `app/live_trading/engine.py` | Main orchestrator |
| `app/live_trading/risk/engine.py` | Pre-trade validation, circuit breakers |
| `app/live_trading/authorization/strategy_gate.py` | Paper approval checks |
| `app/live_trading/exchanges/binance.py` | CCXT adapter + dry-run mode |
| `app/live_trading/execution/executor.py` | Order submission + logging |
| `app/live_trading/execution/leverage.py` | 50→25→20→10→5 fallback |
| `app/live_trading/positions/trailing.py` | TP1 breakeven, TP2 trail, ATR trail |
| `app/live_trading/portfolio/sync.py` | Balance sync from exchange |
| `app/live_trading/monitoring/health.py` | Engine + exchange health |
| `app/live_trading/feedback/memory_loop.py` | Closed trade → Qdrant |
| `app/api/routes_phase8.py` | REST + WebSocket API |

## Safety Defaults

- **`LIVE_DRY_RUN=true`** by default — no real orders without API keys
- **`LIVE_REQUIRE_APPROVAL=true`** — strategies must pass Phase 7 paper validation
- **`LIVE_ALLOW_MANUAL=true`** — dashboard manual orders allowed when approved
- Kill switch closes all positions and disables trading

## Deployment Rules

A strategy may only trade live when:

1. Backtest passed (Phase 3)
2. Paper trading validation passed (Phase 7)
3. Risk approved
4. Strategy approved in paper engine `store.approvals`

Set `LIVE_REQUIRE_APPROVAL=false` for development only.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/live/start` | Start engine + exchange connection |
| POST | `/live/stop` | Stop engine |
| POST | `/live/order` | Submit signal / manual order |
| POST | `/live/close` | Close or partial close |
| POST | `/live/kill-switch` | Emergency: close all + halt |
| POST | `/live/close-all` | Close all positions |
| POST | `/live/pause` | Pause execution |
| POST | `/live/resume` | Resume execution |
| GET | `/live/dashboard` | Dashboard bundle |
| GET | `/live/positions` | Open positions |
| GET | `/live/risk` | Risk status |
| GET | `/live/portfolio` | Portfolio snapshot |
| WS | `/live/ws` | Real-time updates |

## Signal Format

```json
{
  "symbol": "BTCUSDT",
  "direction": "SHORT",
  "confidence": 91,
  "entry": 102500,
  "sl": 103000,
  "tp1": 102000,
  "tp2": 101500,
  "tp3": "trail",
  "strategy_name": "smc_mtf_v2",
  "manual_override": false
}
```

## Trade Lifecycle

```
Signal → Strategy Gate → Risk Validation → Sizing → Order Submit
  → Fill Confirm → Position Monitor → Trailing SL → Exit → Memory Feedback
```

## Configuration

See `.env.example` Phase 8 section:

- `LIVE_ENABLED`, `LIVE_DRY_RUN`, `LIVE_REQUIRE_APPROVAL`
- `LIVE_MAX_DAILY_LOSS_PCT`, `LIVE_MAX_DRAWDOWN_PCT`
- `BINANCE_API_KEY`, `BINANCE_API_SECRET`, `BINANCE_TESTNET`

## Database

Migration: `supabase/migrations/014_phase8_live_trading.sql`

Tables: `live_accounts`, `live_orders`, `live_positions`, `live_trades`, `execution_logs`, `risk_events`, `portfolio_snapshots`, `exchange_status`, `strategy_deployments`, `circuit_breakers`

Runtime uses in-memory store (same pattern as Phase 7); schema ready for persistence.

## Dashboard

Analytics dashboard: `/live` — real-time equity, positions, risk status, kill switch.

## Emergency Procedures

1. **Kill Switch** — `POST /live/kill-switch` or dashboard button
2. **Close All** — `POST /live/close-all`
3. **Pause** — `POST /live/pause` (no new orders)
4. **Reset Circuit** — `POST /live/reset-circuit` (after manual review)

## Testing

```bash
cd research-platform
pytest tests/test_phase8.py -v
```

All tests run in dry-run mode without exchange credentials.

## Future (Phase 9–10)

- n8n AI agent direct order routing
- Multi-exchange: Bybit, OKX, Hyperliquid via CCXT
- Binance User Data Stream WebSocket for sub-second sync
