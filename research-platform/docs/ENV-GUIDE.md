# Environment Variables Guide

Copy `.env.example` to `.env` and configure:

## Application

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_NAME` | research-platform | Service name |
| `APP_ENV` | development | `development`, `staging`, `production` |
| `LOG_LEVEL` | INFO | Logging level |
| `API_HOST` | 0.0.0.0 | Bind host |
| `API_PORT` | 8100 | Bind port |

## Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | postgresql+asyncpg://... | PostgreSQL connection (Supabase-compatible) |
| `DATABASE_POOL_SIZE` | 10 | Connection pool size |
| `DATABASE_MAX_OVERFLOW` | 20 | Max overflow connections |

## Cache & Storage

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | redis://localhost:6380/0 | Redis for cache/monitoring |
| `DATA_ROOT` | ./data | Parquet root directory |

## Sync

| Variable | Default | Description |
|----------|---------|-------------|
| `DEFAULT_EXCHANGES` | binance,bybit,okx,hyperliquid | Supported exchanges |
| `DEFAULT_TIMEFRAMES` | 1m,5m,15m,30m,1h,4h,1d | Timeframes to sync |
| `SYNC_BATCH_SIZE` | 1000 | CCXT fetch batch size |
| `SYNC_RATE_LIMIT_MS` | 200 | Delay between batches (ms) |

## Exchange API Keys (optional)

Public OHLCV endpoints work without keys. Keys may be required for higher rate limits or private endpoints.

| Variable | Exchange |
|----------|----------|
| `BINANCE_API_KEY` / `BINANCE_API_SECRET` | Binance Futures |
| `BYBIT_API_KEY` / `BYBIT_API_SECRET` | Bybit |
| `OKX_API_KEY` / `OKX_API_SECRET` / `OKX_PASSPHRASE` | OKX |

## Scheduler

| Variable | Default | Description |
|----------|---------|-------------|
| `SCHEDULER_ENABLED` | true | Enable APScheduler on startup |
| `SYNC_INTERVAL_MINUTES` | 15 | Incremental sync interval |

## Supabase

Use your Supabase PostgreSQL connection string:

```
DATABASE_URL=postgresql+asyncpg://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
```

Run migrations against Supabase the same way: `alembic upgrade head`.
