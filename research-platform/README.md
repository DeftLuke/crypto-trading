# Research Platform — Phase 1

Institutional-grade historical market data collection, storage, feature generation, and research foundation for crypto futures trading.

## Features

- **Multi-exchange OHLCV sync** — Binance, Bybit, OKX, Hyperliquid via CCXT
- **Dual storage** — Parquet (local bulk) + PostgreSQL (queryable)
- **Incremental sync** — Full history on first run, gap detection and auto-repair
- **Futures data** — Funding rates and open interest
- **Indicator engine** — EMA20/50/100/200, RSI14, ATR14, MACD, VWAP (Polars)
- **SMC interface** — Normalized schema for BOS, CHOCH, OB, FVG, Liquidity Sweep (stub detector in Phase 1)
- **Research datasets** — Combined feature Parquet + DB for AI training
- **Scheduler** — APScheduler jobs for sync, validation, indicators, datasets
- **REST API** — FastAPI with OpenAPI docs

## Quick Start

### Prerequisites

- Python 3.12+
- Docker & Docker Compose (Redis; Postgres optional if using Supabase)

### Supabase (production — recommended)

See **[docs/SUPABASE-SETUP.md](docs/SUPABASE-SETUP.md)** for full steps.

```bash
cd research-platform
cp .env.example .env
# Edit DATABASE_URL with your Supabase URI from backend/.env
# Run supabase/migrations/007_research_platform.sql in Supabase SQL Editor
uvicorn app.main:app --port 8100
```

### Docker (recommended)

```bash
cd research-platform
cp .env.example .env
docker compose up -d redis research-api
```

For local Postgres instead of Supabase:

```bash
docker compose --profile local up -d
docker compose run --rm research-api alembic upgrade head
```

API: http://localhost:8100/docs

### Local development

```bash
cd research-platform
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env

docker compose up -d postgres redis
alembic upgrade head
uvicorn app.main:app --reload --port 8100
```

### Add symbol and sync

```bash
curl -X POST http://localhost:8100/symbols/add \
  -H "Content-Type: application/json" \
  -d '{"exchange":"binance","symbol":"BTCUSDT","market_type":"futures"}'

curl -X POST http://localhost:8100/sync/start \
  -H "Content-Type: application/json" \
  -d '{"exchange":"binance","symbol":"BTCUSDT","timeframe":"15m","full":true}'
```

## Project Structure

```
research-platform/
├── app/
│   ├── api/              # FastAPI routes
│   ├── core/             # Config, logging
│   ├── models/           # SQLAlchemy ORM
│   ├── schemas/          # Pydantic DTOs
│   ├── repositories/     # DB + Parquet access
│   ├── services/         # Sync, validation, indicators, datasets
│   ├── storage/          # Parquet layout
│   ├── indicators/       # Polars indicator framework
│   ├── smc/              # SMC interfaces (Phase 1 stub)
│   ├── workers/          # APScheduler
│   └── tasks/            # Job definitions
├── alembic/              # PostgreSQL migrations
├── tests/
├── data/                 # Parquet storage (gitignored)
└── docs/
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Service health + DB/Parquet/Redis checks |
| GET | `/symbols` | List active symbols |
| POST | `/symbols/add` | Register symbol for sync |
| POST | `/sync/start` | Start OHLCV sync job |
| GET | `/sync/status?job_id=` | Sync job status |
| GET | `/candles` | Query candles from Parquet |
| GET | `/indicators` | Compute indicators sample |
| GET | `/dataset/status` | Feature dataset build status |
| GET | `/system/health` | Monitoring snapshots |

All routes also available under `/api/v1/`.

## Data Layout

```
data/
├── binance/
│   └── BTCUSDT/
│       ├── 15m.parquet
│       └── 1h.parquet
└── datasets/
    └── binance/
        └── BTCUSDT/
            └── 15m_features.parquet
```

## Environment Variables

See [`.env.example`](.env.example) and [`docs/ENV-GUIDE.md`](docs/ENV-GUIDE.md).

## Tests

```bash
pytest -v
```

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/PHASE1-PLAN.md`](docs/PHASE1-PLAN.md).

## Phase 2 — Indicator & SMC Engine ✅

See [docs/PHASE2-ARCHITECTURE.md](docs/PHASE2-ARCHITECTURE.md) and [docs/PHASE2-DEVELOPER-GUIDE.md](docs/PHASE2-DEVELOPER-GUIDE.md).

Run migration: `supabase/migrations/008_phase2_engine.sql`

## Phase 3 — Institutional Backtesting Engine ✅

See [docs/PHASE3-BACKTEST-ENGINE.md](docs/PHASE3-BACKTEST-ENGINE.md).

Run migration: `supabase/migrations/010_phase3_backtest_engine.sql`

```bash
# Start backtest
curl -X POST http://localhost:8100/backtest/start \
  -H "Content-Type: application/json" \
  -d '{"name":"BTC_15m","mode":"single","symbols":["BTCUSDT"],"timeframe":"15m"}'

# Check status & results
curl "http://localhost:8100/backtest/status?backtest_id=<uuid>"
curl "http://localhost:8100/backtest/results?backtest_id=<uuid>"
```

## Phase 5 — Qdrant Memory Layer ✅

See [docs/PHASE5-MEMORY-LAYER.md](docs/PHASE5-MEMORY-LAYER.md), [docs/QDRANT-SETUP.md](docs/QDRANT-SETUP.md).

Run migration: `supabase/migrations/011_phase5_memory_layer.sql`

```bash
docker compose up -d qdrant redis research-api

# Store trade memory
curl -X POST http://localhost:8100/memory/trade \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSDT","direction":"SHORT","result":"WIN","profit_percent":3.8,"smc_features":{"bos":true,"ob":true}}'

# Recall similar setups
curl -X POST http://localhost:8100/memory/recall \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSDT","direction":"SHORT","rsi":83,"smc_features":{"bos":true}}'

# Dashboard bundle (Phase 4)
curl http://localhost:8100/memory/dashboard
```

## Phase 6 — AI Research Agent ✅

See [docs/PHASE6-AI-RESEARCH-AGENT.md](docs/PHASE6-AI-RESEARCH-AGENT.md).

Run migration: `supabase/migrations/012_phase6_ai_research_agent.sql`

```bash
# Run one research cycle
curl -X POST http://localhost:8100/agent/research/cycle

# Agent dashboard (Phase 4)
curl http://localhost:8100/agent/dashboard
```

## Phase 7 — Paper Trading Engine ✅

See [docs/PHASE7-PAPER-TRADING.md](docs/PHASE7-PAPER-TRADING.md).

Run migration: `supabase/migrations/013_phase7_paper_trading.sql`

```bash
curl -X POST http://localhost:8100/paper/start
curl -X POST http://localhost:8100/paper/order -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSDT","direction":"SHORT","confidence":91,"entry":102500,"sl":103000,"tp1":102000,"strategy_name":"SMC_MTF_V1"}'
curl http://localhost:8100/paper/dashboard
```

## Phase 8 — Live Trading Engine ✅

See [docs/PHASE8-LIVE-TRADING.md](docs/PHASE8-LIVE-TRADING.md).

Run migration: `supabase/migrations/014_phase8_live_trading.sql`

**Safety:** `LIVE_DRY_RUN=true` by default. Set API keys + `LIVE_DRY_RUN=false` only when ready for real execution.

```bash
curl -X POST http://localhost:8100/live/start
curl -X POST http://localhost:8100/live/order -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSDT","direction":"SHORT","confidence":91,"entry":102500,"sl":103000,"tp1":102000,"strategy_name":"manual","manual_override":true}'
curl http://localhost:8100/live/dashboard
```

## Phase 9 — n8n AI Agent & Operations ✅

See [docs/PHASE9-N8N-AGENT.md](docs/PHASE9-N8N-AGENT.md).

Run migration: `supabase/migrations/015_phase9_n8n_agent.sql`

Import n8n workflows: `platform-ai-chat.json`, `platform-events.json`, `daily-summary.json`

```bash
curl -X POST http://localhost:8100/agent/chat -H "Content-Type: application/json" \
  -d '{"message":"Show my best strategy and system health","channel":"api"}'
curl http://localhost:8100/operations/dashboard
```

## Phase 10 — Enterprise Control Center ✅

See [docs/PHASE10-CONTROL-CENTER.md](docs/PHASE10-CONTROL-CENTER.md).

Run migration: `supabase/migrations/016_phase10_control_center.sql`

Re-import n8n workflows (trade-execution now uses `/control/signal`).

```bash
curl http://localhost:8100/control/dashboard
curl -X POST http://localhost:8100/control/signal -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSDT","direction":"SHORT","entry":102500,"sl":103000,"tp1":102000,"strategy_name":"manual"}'
```

## Future Phases

| Phase | Module |
|-------|--------|
| 4–9 | All complete ✅ |
| 10 | Enterprise control center ✅ |
| 11+ | Full RBAC/JWT, Prometheus/Grafana stack, multi-region |

## License

Private — internal research use.
