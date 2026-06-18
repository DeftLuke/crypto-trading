# Memory Lifecycle Guide

## 1. Ingest

Events enter memory via API:

```
Trade closes  → POST /memory/trade (+ auto reflection optional)
Signal fired  → POST /memory/signal
Backtest done → POST /memory/backtest
AI reflects   → POST /memory/reflection
```

Each record:

1. Validated via Pydantic schema
2. Flattened to searchable `text`
3. Embedded via configured provider
4. Upserted to Qdrant with payload + OWM weights

## 2. Weight (OWM)

After storage, outcome weights adjust:

- Wins strengthen memory importance
- Losses weaken it
- Recalls increment `usage_count`

## 3. Rank

On search/recall, `memory_rank` combines:

- Recency (30-day half-life)
- Profitability (PF, win rate, PnL)
- Confidence
- Usage frequency
- Vector similarity
- OWM success score

## 4. Recall (Phase 6+)

Before AI decisions:

```
POST /memory/recall  → similar historical setups
POST /memory/search  → semantic search any collection
GET  /memory/agent-state → current learning context
```

## 5. Learn (Worker)

Every 10 minutes:

1. Analyze trade memories
2. Discover patterns (≥5 trades per cluster)
3. Generate pattern reflections
4. Update agent state memory

Manual trigger: `POST /memory/learning-cycle`

## 6. Audit (PostgreSQL)

Migration `011_phase5_memory_layer.sql`:

- `research_memory_audit` — operation log
- `research_memory_worker_runs` — worker history

## Dashboard (Phase 4)

`GET /memory/dashboard` aggregates top patterns, reflections, and learning progress for the analytics terminal.
