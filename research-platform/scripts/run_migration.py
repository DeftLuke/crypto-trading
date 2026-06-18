#!/usr/bin/env python3
"""Apply research-platform schema to Supabase. Usage: python scripts/run_migration.py"""

from pathlib import Path

import psycopg2
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
env = dotenv_values(ROOT / ".env")
url = env.get("DATABASE_URL", "").strip('"').strip("'")

if not url:
    raise SystemExit("DATABASE_URL not set in research-platform/.env")

# Parse postgresql://user:pass@host:port/db
from urllib.parse import urlparse

parsed = urlparse(url.replace("+asyncpg", ""))
password = env.get("SUPABASE_DB_PASSWORD") or parsed.password or ""
host = env.get("SUPABASE_POOLER_HOST") or parsed.hostname
port = int(env.get("DATABASE_PORT") or parsed.port or 5432)
user = parsed.username or "postgres"

conn = psycopg2.connect(
    host=host,
    port=port,
    user=user,
    password=password,
    dbname=parsed.path.lstrip("/") or "postgres",
    sslmode="require",
)
sql = (ROOT.parent / "supabase/migrations/007_research_platform.sql").read_text(encoding="utf-8")
conn.autocommit = True
cur = conn.cursor()
cur.execute(sql)
cur.execute("SELECT to_regclass('public.symbols'), to_regclass('public.candles')")
print("Migration OK:", cur.fetchone())
cur.close()
conn.close()
