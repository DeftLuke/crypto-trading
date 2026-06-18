# Qdrant Setup Guide — Phase 5

## Docker (recommended)

From `research-platform/`:

```bash
docker compose up -d qdrant redis research-api
```

Qdrant UI: http://localhost:6333/dashboard

## Local standalone

```bash
docker run -p 6333:6333 -p 6334:6334 \
  -v $(pwd)/qdrant_data:/qdrant/storage \
  qdrant/qdrant:v1.12.5
```

## Environment

```env
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=           # optional for local
MEMORY_ENABLED=true
MEMORY_EMBEDDING_PROVIDER=hash   # or bge-small for production
MEMORY_VECTOR_SIZE=384
```

## Production (VPS)

1. Add Qdrant to your Docker stack or use [Qdrant Cloud](https://cloud.qdrant.io)
2. Set `QDRANT_URL` and `QDRANT_API_KEY`
3. Use `bge-small` embedding on machines with ≥4GB RAM
4. Use `hash` on low-RAM VPS for functional recall (deterministic vectors)

## Verify

```bash
curl http://localhost:6333/collections
curl http://localhost:8100/memory/stats
curl http://localhost:8100/health   # checks["qdrant"] should be "ok"
```

## Collections

Created automatically on first API call:

- trade_memories, signal_memories, backtest_memories
- strategy_memories, pattern_memories, reflection_memories
- risk_memories, market_memories, agent_state_memories, deployment_memories

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `qdrant: degraded` in health | Start Qdrant container, check `QDRANT_URL` |
| Slow first embed | BGE model downloads on first use (~130MB for small) |
| OOM on VPS | Set `MEMORY_LOW_RAM=true` or `MEMORY_EMBEDDING_PROVIDER=hash` |
| Tests fail | Tests use `:memory:` Qdrant — no Docker needed |
