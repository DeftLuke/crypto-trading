# Phase 6 — AI Research Agent

Autonomous quantitative research analyst for the institutional trading platform. The agent **does not execute trades** — it researches, hypothesizes, evaluates, reflects, and learns.

## Agent Types

| Agent | Role |
|-------|------|
| **CoordinatorAgent** | Orchestrates full research workflow |
| **ResearchAgent** | Memory recall + historical analysis (via coordinator) |
| **StrategyAgent** | Generates candidate strategies from hypotheses |
| **ReflectionAgent** | Structured reflections with evidence |
| **ValidationAgent** | Overfitting, drawdown, robustness warnings |
| **RankingAgent** | Composite strategy scoring |
| **LearningAgent** | Best/worst conditions, emerging patterns |
| **PlanningAgent** | Research plans and task lists |
| **MetaLearningPredictor** | Pre-backtest success probability |

## Research Workflow (every 5–10 min)

```
1. Recall memories (Qdrant)
2. Analyze patterns, reflections, winning/losing setups
3. Detect market regime
4. Generate hypotheses
5. Build candidate strategies
6. Meta-score (filter low-probability candidates)
7. Evaluate strategies (memory recall + metrics)
8. Rank by composite score
9. Generate reflections → store in Qdrant
10. Discover patterns → update agent state
11. Produce insights & recommendations
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/agent/research/start` | Start 24/7 research loop |
| POST | `/agent/research/stop` | Stop loop |
| POST | `/agent/research/cycle` | Run single cycle |
| GET | `/agent/status` | Agent state |
| GET | `/agent/insights` | Top discoveries |
| GET | `/agent/hypotheses` | Current hypotheses |
| GET | `/agent/reflections` | Recent reflections |
| GET | `/agent/patterns` | Pattern memories |
| GET | `/agent/recommendations` | AI recommendations |
| GET | `/agent/rankings` | Strategy leaderboard |
| GET | `/agent/plans` | Research plans |
| GET | `/agent/learning` | Learning snapshot |
| GET | `/agent/dashboard` | Phase 4 dashboard bundle |

## Strategy Definition

```json
{
  "strategy_name": "AI_SHORT_a1b2c3d4",
  "conditions": ["RSI > 80", "EMA100 Bearish", "Bearish BOS", "Bearish OB Retest"],
  "direction": "SHORT"
}
```

## Composite Score

Weighted: profitability, Sharpe, Sortino, consistency, drawdown, walk-forward, Monte Carlo, recovery + meta-learning boost.

## Configuration

```env
AGENT_ENABLED=true
AGENT_CYCLE_INTERVAL_MINUTES=7
AGENT_MAX_HYPOTHESES=12
AGENT_MAX_BACKTESTS_PER_CYCLE=5
AGENT_META_THRESHOLD=0.35
AGENT_LOW_RAM=true          # heuristic meta scorer
AGENT_META_LEARNING=true    # sklearn GradientBoosting when available
```

## Quick Start

```bash
# Run one research cycle
curl -X POST http://localhost:8100/agent/research/cycle

# Start 24/7 loop
curl -X POST http://localhost:8100/agent/research/start

# Dashboard data
curl http://localhost:8100/agent/dashboard
```

## Architecture

```
CoordinatorAgent
  ├── AgentMemoryRecall (Phase 5)
  ├── HypothesisGenerator
  ├── StrategyGenerator → StrategyRule (Phase 2/3)
  ├── MetaLearningPredictor
  ├── ScoringEngine + RankingAgent
  ├── ReflectionAgent → Qdrant
  ├── ValidationAgent
  ├── LearningAgent → agent_state_memories
  ├── RegimeDetector
  └── PatternDiscovery (Phase 5)
```

## Future Phases

- **Phase 7** — Top-ranked strategies → paper trading candidates (`action: paper_trade_candidate`)
- **Phase 8** — Live deployment after validation
- **Phase 9** — n8n triggers `/agent/research/cycle` on schedule

## See also

- [MEMORY-LIFECYCLE.md](./MEMORY-LIFECYCLE.md) — Phase 5 memory integration
- [PHASE3-BACKTEST-ENGINE.md](./PHASE3-BACKTEST-ENGINE.md) — full backtest launch (optional extension)
