# Phase 9 — n8n AI Agent & Autonomous Operations

The intelligent operating layer connecting all platform phases via natural language, tool calling, n8n workflows, and memory recall.

## Architecture

```
User (Dashboard / Telegram / Discord / n8n)
        ↓
Operations Engine (Phase 9)
        ↓
Intent Classification → Memory Recall → Tool Execution → LLM Synthesis
        ↓
Phases 1–8 APIs (backtest, memory, agent, paper, live, signals)
        ↓
n8n Event Workflows → Notifications
```

## Core Principle

**No hardcoded responses.** Every answer is built from:
1. Recalled Qdrant memories (Phase 5)
2. Live platform data via tools
3. LLM synthesis (AI gateway or OpenAI-compatible API)
4. Structured fallback when LLM unavailable (still data-driven)

## Module Layout

| Path | Role |
|------|------|
| `app/operations/engine.py` | Main orchestrator |
| `app/operations/agents/coordinator.py` | NL routing + tool orchestration |
| `app/operations/tools/registry.py` | 15 platform tools |
| `app/operations/llm/gateway.py` | Dynamic LLM + intent classification |
| `app/operations/workflows/runner.py` | Event-driven + n8n triggers |
| `app/operations/reports/engine.py` | JSON/CSV reports |
| `app/operations/notifications/engine.py` | Telegram, Discord, n8n |
| `app/api/routes_phase9.py` | REST API |

## Tools

| Tool | Phase |
|------|-------|
| `search_trades` | 7, 8 |
| `search_strategies` | 7 |
| `search_backtests` | 3 |
| `search_memories` | 5 |
| `search_reflections` | 5, 6 |
| `search_signals` | 2, 6 |
| `search_positions` | 7, 8 |
| `search_risk_events` | 8 |
| `get_risk_status` | 7, 8 |
| `launch_research` | 6 |
| `launch_backtest` | 3 |
| `approve_strategy` | 7 (human confirmation required) |
| `pause_strategy` | 8 (confirmation required) |
| `generate_report` | 9 |
| `system_health` | All |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/agent/chat` | Natural language chat |
| POST | `/agent/task` | Multi-step background task |
| POST | `/agent/report` | Generate report |
| POST | `/agent/workflow/run` | Run named workflow |
| POST | `/operations/event` | Emit platform event |
| POST | `/operations/telegram` | Telegram command handler |
| GET | `/agent/history` | Conversation history |
| GET | `/agent/tasks` | Active/recent tasks |
| GET | `/agent/reports` | Generated reports |
| GET | `/operations/status` | Operations status |
| GET | `/agent/workflows` | Workflow run history |
| GET | `/operations/dashboard` | Dashboard bundle |

## n8n Workflows

Import from `n8n/workflows/`:

| Workflow | Webhook | Purpose |
|----------|---------|---------|
| `platform-ai-chat.json` | `/webhook/platform-ai` | NL chat via research API |
| `platform-events.json` | `/webhook/platform-event` | Event-driven notifications |
| `daily-summary.json` | Schedule | Daily report + Telegram |

Set n8n env: `RESEARCH_API_URL=http://research-api:8100`

## Telegram Commands

```
/performance  /risk  /trades  /strategies  /research  /health  /help
```

Natural language also supported via `/operations/telegram`.

## Event Types

`backtest_completed`, `research_completed`, `strategy_approved`, `strategy_rejected`, `trade_opened`, `trade_closed`, `risk_event`, `system_error`, `memory_update`, `pattern_discovery`

## Security

- Strategy approval and pause require human confirmation
- Agent cannot override risk engine automatically
- All chat/actions logged in audit store
- API keys via environment variables only

## Configuration

```env
OPERATIONS_ENABLED=true
AI_GATEWAY_URL=https://ai.deftluke.online
N8N_BASE_URL=https://n8n.deftluke.online
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

## Database

Migration: `supabase/migrations/015_phase9_n8n_agent.sql`

## Testing

```bash
cd research-platform
pytest tests/test_phase9.py -v
```

## Dashboard

Analytics dashboard: `/assistant` — embedded AI chat with task/report panels.

## Future (Phase 10+)

- Voice interface via n8n + speech APIs
- Mobile app chat SDK
- Autonomous multi-agent research swarms
