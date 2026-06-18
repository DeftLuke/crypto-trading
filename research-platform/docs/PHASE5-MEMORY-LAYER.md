# Phase 5 — Qdrant Memory Layer

Production-grade vector memory for institutional AI trading — semantic recall, outcome-weighted learning, and continuous pattern discovery.

## Overview

Every meaningful trading event becomes searchable memory:

| Collection | Purpose |
|------------|---------|
| `trade_memories` | Trade entries/exits, wins/losses |
| `signal_memories` | Generated signals + outcomes |
| `backtest_memories` | Backtest summaries |
| `strategy_memories` | Strategy rules + evolution |
| `pattern_memories` | Discovered recurring setups |
| `reflection_memories` | AI/system reflections |
| `risk_memories` | Risk events |
| `market_memories` | Market context snapshots |
| `agent_state_memories` | Agent learning state |
| `deployment_memories` | Deployment history |

## Architecture

```
FastAPI (Phase 5 routes)
    │
    ├── MemoryService ── EmbeddingService (BGE / hash / OpenAI-compat)
    │       │
    │       ├── QdrantMemoryStore (10 collections)
    │       ├── RetrievalEngine (semantic / keyword / hybrid)
    │       ├── TradeRecallEngine
    │       ├── ReflectionEngine
    │       ├── PatternDiscovery
    │       └── AgentStateManager
    │
    ├── OWM (Outcome Weighted Memory)
    ├── Memory Ranking
    └── Background Worker (every 10 min)
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/memory/trade` | Store trade memory |
| POST | `/memory/signal` | Store signal memory |
| POST | `/memory/backtest` | Store backtest memory |
| POST | `/memory/reflection` | Store reflection |
| POST | `/memory/pattern` | Store pattern |
| POST | `/memory/strategy` | Store strategy |
| POST | `/memory/recall` | Similar trade recall |
| POST | `/memory/search` | Semantic/keyword/hybrid search |
| GET | `/memory/stats` | Collection sizes + embedding info |
| GET | `/memory/collections` | Collection list |
| GET | `/memory/top-patterns` | Top patterns for dashboard |
| GET | `/memory/reflections` | Recent reflections |
| GET | `/memory/agent-state` | Current agent learning state |
| GET | `/memory/dashboard` | Phase 4 dashboard bundle |
| POST | `/memory/learning-cycle` | Manual learning worker trigger |

All routes also available under `/api/v1/memory/*`.

## Embedding Providers

| Provider | Env | Use case |
|----------|-----|----------|
| `hash` (default) | `MEMORY_EMBEDDING_PROVIDER=hash` | Tests, low-RAM VPS |
| `bge-small` | `MEMORY_EMBEDDING_PROVIDER=bge-small` | Production (384-dim) |
| `bge-base` | `MEMORY_EMBEDDING_PROVIDER=bge-base` | Higher quality (768-dim) |
| `openai` | `MEMORY_EMBEDDING_API_URL` + key | OpenAI/Jina compatible API |

## Outcome Weighted Memory (OWM)

- **WIN** → `memory_weight × 1.12`, `success_score + 0.08`
- **LOSS** → `memory_weight × 0.88`, `success_score - 0.06`
- **Recall usage** → `usage_count++`, slight weight boost

## Memory Ranking

Composite score from: recency, profitability, confidence, usage, similarity, OWM weight.

## Trade Recall Example

```bash
curl -X POST http://localhost:8100/memory/recall \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "BTCUSDT",
    "direction": "SHORT",
    "rsi": 83,
    "smc_features": {"bos": true, "ob": true, "liquidity_sweep": true}
  }'
```

Returns: `win_rate`, `average_profit_percent`, `confidence`, `examples`.

## Continuous Learning Worker

Runs every `MEMORY_WORKER_INTERVAL_MINUTES` (default 10):

1. Scroll recent trade memories
2. Discover patterns (min 5 trades per cluster)
3. Update agent state memory
4. Store top patterns

## Phase 4 Dashboard

`GET /memory/dashboard` returns:

- `top_patterns`
- `top_reflections`
- `agent_state`
- `stats`
- `learning_progress`

## Future Phases

- **Phase 6** — AI Research Agent calls `/memory/recall` before decisions
- **Phase 7/8** — Auto-store trades on open/close via webhooks
- **Phase 9** — n8n stores reflections and triggers learning cycle

## See also

- [QDRANT-SETUP.md](./QDRANT-SETUP.md)
- [MEMORY-LIFECYCLE.md](./MEMORY-LIFECYCLE.md)
