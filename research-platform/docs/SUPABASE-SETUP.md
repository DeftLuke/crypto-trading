# Supabase Setup — Research Platform

Use the same Supabase project as your TradeGPT backend (`backend/.env`).

## 1. Get your connection string

In [Supabase Dashboard](https://supabase.com/dashboard) → **Project Settings** → **Database**:

| Connection type | When to use |
|-----------------|-------------|
| **Direct** (`db.xxx.supabase.co:5432`) | Migrations, long-running sync jobs |
| **Session pooler** (`pooler.supabase.com:5432`) | FastAPI app in production |
| **Transaction pooler** (`pooler.supabase.com:6543`) | High concurrency / serverless |

Copy the URI and replace `[YOUR-PASSWORD]` with your database password.

## 2. Configure research-platform

```bash
cd research-platform
cp .env.example .env
```

Edit `.env` — **Option A** (simplest):

```env
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@db.YOUR_PROJECT_REF.supabase.co:5432/postgres
DATABASE_SSL=true
APP_ENV=production
```

Or reuse the same `DATABASE_URL` from `backend/.env` (works as-is; `+asyncpg` is added automatically).

**Option B** — build from parts:

```env
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_PROJECT_REF=YOUR_PROJECT_REF
SUPABASE_DB_PASSWORD=YOUR_PASSWORD
DATABASE_SSL=true
```

## 3. Create tables in Supabase

**Option A — SQL migration (recommended, matches existing repo pattern):**

1. Open Supabase → **SQL Editor**
2. Run `supabase/migrations/007_research_platform.sql`

**Option B — Alembic:**

```bash
cd research-platform
pip install -r requirements.txt
alembic upgrade head
```

Both create the same tables. Use only one method.

## 4. Verify connection

```bash
uvicorn app.main:app --port 8100
curl http://localhost:8100/health
```

Expected: `"database": "ok"` in the `checks` object.

## 5. Docker with Supabase (no local Postgres)

```bash
docker compose up -d redis research-api
```

Local Postgres is behind the `local` profile — only start it for dev:

```bash
docker compose --profile local up -d
```

## 6. Share credentials with backend

Both services can use the **same Supabase database**:

| Service | Tables |
|---------|--------|
| Node backend | `signals`, `trades`, `agent_*`, … |
| Research platform | `candles`, `symbols`, `indicator_values`, … |

No table name conflicts — they coexist in the same `postgres` database.

## Troubleshooting

| Error | Fix |
|-------|-----|
| `SSL required` | Set `DATABASE_SSL=true` |
| `password authentication failed` | Reset password in Supabase Dashboard → Database |
| `connection refused` | Check IP allowlist (Supabase → Database → Network) |
| Pooler timeout on migrations | Use **direct** connection (port 5432) for `alembic upgrade head` |

## VPS deploy

On your VPS, set in `research-platform/.env`:

```env
DATABASE_URL=postgresql://postgres:...@db.xxx.supabase.co:5432/postgres
DATABASE_SSL=true
DATA_ROOT=/app/data
REDIS_URL=redis://redis:6379/0
```

Mount `./data` as a persistent volume for Parquet files (PostgreSQL holds queryable copies; Parquet is the bulk archive).
