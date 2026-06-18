# Phase 3 — Institutional Backtesting Engine

## Overview

Phase 3 adds a production-grade backtesting and strategy validation engine integrated with:

- **Phase 1** — Historical candle warehouse (Parquet + PostgreSQL)
- **Phase 2** — Indicator engine, SMC engine, signal/rules engine

## Architecture

```
POST /backtest/start
        │
        ▼
  BacktestRunner (async job)
        │
        ▼
  BacktestEngine
   ├── FeaturePipeline (Polars lazy load)
   ├── TradeSimulator (bar-by-bar)
   ├── RiskEngine (sizing, circuit breaker)
   ├── MetricsEngine
   ├── AnalyticsEngine
   ├── WalkForwardEngine
   └── MonteCarloEngine
        │
        ▼
  ExportEngine → JSON/CSV/Parquet
        │
        ▼
  BacktestRepository → Supabase PostgreSQL
```

## Backtesting Modes

| Mode | Description |
|------|-------------|
| `single` | One symbol, full history |
| `multi` | Multiple symbols, parallel workers |
| `portfolio` | Combined portfolio simulation |
| `walkforward` | Rolling train/validate windows |
| `monte_carlo` | Trade-sequence stress testing |

## Trade Lifecycle

Every bar:

1. Load features (indicators + SMC + MTF)
2. Evaluate strategy rules (Phase 2)
3. Score confluence
4. Open position (risk engine sizing)
5. Manage exits (SL/TP/trailing/time/structure)
6. Record trade + equity point

## Risk Configuration

Default matches institutional spec:

```json
{
  "account_balance": 100,
  "risk_pct": 0.01,
  "margin_pct": 0.5,
  "leverage": 50,
  "leverage_fallback": [50, 25, 20, 10]
}
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/backtest/start` | Start backtest job |
| POST | `/backtest/stop` | Stop running job |
| GET | `/backtest/status` | Job progress |
| GET | `/backtest/results` | Summary metrics |
| GET | `/backtest/trades` | Trade log |
| GET | `/backtest/equity` | Equity curve |
| GET | `/backtest/drawdown` | Drawdown report |
| GET | `/backtest/monthly` | Monthly PnL |
| GET | `/backtest/sessions` | Session analytics |
| GET | `/backtest/smc` | SMC feature analytics |
| GET | `/backtest/monte-carlo` | Monte Carlo results |
| GET | `/backtest/walkforward` | Walk-forward folds |
| POST | `/backtest/rankings` | Strategy comparison |

## Database Migration

Run in Supabase SQL Editor:

```
supabase/migrations/010_phase3_backtest_engine.sql
```

## Example

```bash
curl -X POST http://localhost:8100/backtest/start \
  -H "Content-Type: application/json" \
  -d '{
    "name": "BTC_1Y_15m",
    "mode": "single",
    "symbols": ["BTCUSDT"],
    "timeframe": "15m",
    "config": {
      "risk": {"account_balance": 100, "risk_pct": 0.01, "leverage": 50}
    }
  }'

curl "http://localhost:8100/backtest/status?backtest_id=<id>"
curl "http://localhost:8100/backtest/results?backtest_id=<id>"
```

## Future Compatibility

Outputs are structured for direct consumption by:

- Phase 4 — Analytics Dashboard
- Phase 5 — Qdrant Memory Layer
- Phase 6 — AI Research Agent
- Phase 7 — Paper Trading
- Phase 8 — Live Trading

Trade records include full feature snapshots, SMC context, session tags, and standardized metrics JSON.

## Performance

- Polars LazyFrame for candle reads
- Chunked DB batch inserts (500 trades/batch)
- Multiprocessing for multi-symbol runs (`max_workers` config)
- Equity curve downsampled for DB storage
- Feature dataset Parquet cache supported

## Tests

```bash
cd research-platform
pytest tests/test_phase3.py -v
```
