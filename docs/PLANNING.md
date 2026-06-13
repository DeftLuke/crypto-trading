# Crypto Trading System — Master Plan

> **Architecture principle:** Dashboard = Strategy Brain | n8n = Execution Guard | Telegram = Manual Entry | AI Agent = Memory & Learning

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         REACT DASHBOARD (Brain)                          │
│  Charts · EMA/RSI · OB/BOS/CHoCH · Signals · Trades · Performance       │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ REST + WebSocket
┌───────────────────────────────▼─────────────────────────────────────────┐
│                      NODE.JS BACKEND (Strategy Engine)                    │
│  MTF Analysis · SMC Logic · Signal Engine · Risk Manager · Position Mon  │
└───────┬─────────────────┬──────────────────────┬──────────────────────────┘
        │                 │                      │
   Binance WS       Supabase DB            Telegram API
   Binance REST          │                      │
        │                 │                      │
        └────────┬────────┴──────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────────────────┐
│                           n8n (Execution Guard)                          │
│  Webhook → Validate → Risk Check → Execute → SL/TP → Notify → Log       │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────────┐
│              AI AGENT (Kali Server — Ollama + pgvector memory)            │
│  Trade lessons · Pair performance · Telegram Q&A · Signal refinement    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Multi-Timeframe Strategy Flow (from your Pine Script)

| Step | Timeframe | Purpose | Pass Condition |
|------|-----------|---------|----------------|
| 1 | **1H** | Trend direction | Bullish structure (BOS up / CHoCH bullish) + price > EMA100 for LONG |
| 2 | **30M** | Confirmation | Same direction as 1H, no opposing CHoCH |
| 3 | **15M** | Order Block zone | Valid demand/supply OB exists, not mitigated |
| 4 | **5M / 3M** | Scalp entry | OB retest + rejection candle + RSI filter |

**Entry rule:** NEVER enter without OB retest + rejection confirmation on 5M/3M.

---

## 3. Strategy Rules (Exact)

### Trend Filter
- Price > EMA100 → **LONG only**
- Price < EMA100 → **SHORT only**

### RSI Filter
- RSI < 25 → Oversold buy zone (LONG bias)
- RSI > 80 → Overbought sell zone (SHORT bias)
- RSI 25–80 → Normal zone, requires SMC + OB confirmation

### SMC Rules
- Detect BOS (Break of Structure) and CHoCH (Change of Character)
- Detect liquidity sweeps (wick beyond swing high/low then reversal)
- Identify Order Blocks (demand/supply zones from last opposing candle before impulse)
- **OB retest is MANDATORY** — price must touch OB zone and show rejection

### Volatility Filter
- Daily change > +30% OR < -30% → **IGNORE** (pump/dump protection)

### Signal Output
Each signal includes:
- Direction: BUY / SELL / IGNORE
- Confidence: 0–100
- Reason breakdown (EMA, RSI, SMC, OB, volatility)
- Entry, SL, TP1/TP2/TP3 levels

---

## 4. Risk Management

| Rule | Value |
|------|-------|
| Risk per trade | 1% of balance |
| Max daily loss | 3% |
| Max trades/day | 3–5 |
| SL (Long) | Below OB low |
| SL (Short) | Above OB high |
| TP1 | 1R — close 30%, move SL to breakeven |
| TP2 | 2R — close 40%, lock SL at +1R |
| TP3 | Trailing stop on remainder |

**Execution model:**
- **Entry:** Manual via Telegram [BUY NOW] button (you confirm)
- **SL/TP:** Automatic via backend position monitor + Binance orders
- **Emergency exit:** Auto-close if strategy invalidates (CHoCH against position)

---

## 5. Top 20 Pairs (Focus Universe)

```
BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, XRPUSDT,
ADAUSDT, DOGEUSDT, AVAXUSDT, DOTUSDT, LINKUSDT,
MATICUSDT, LTCUSDT, UNIUSDT, ATOMUSDT, ETCUSDT,
FILUSDT, NEARUSDT, APTUSDT, ARBUSDT, OPUSDT
```

Strategy performance is tracked **per pair** in `performance_metrics` and fed to AI memory.

---

## 6. Database Schema (Supabase)

| Table | Purpose |
|-------|---------|
| `signals` | All generated signals with confidence + reasons |
| `trades` | Open/closed trades, entry/SL/TP, PnL, lessons |
| `balances` | Daily balance snapshots |
| `logs` | System events, errors, n8n webhooks |
| `performance_metrics` | Win rate, avg R, best pairs, daily stats |
| `trade_lessons` | AI-readable lessons from each closed trade |
| `pair_stats` | Per-pair strategy effectiveness scores |

---

## 7. n8n Workflows

| Workflow | File | Purpose |
|----------|------|---------|
| Trade Execution | `n8n/workflows/trade-execution.json` | BUY NOW → validate → execute → SL/TP |
| Telegram Bot | `n8n/workflows/telegram-bot.json` | Signals + buttons + Q&A routing |
| Position Monitor | `n8n/workflows/position-monitor.json` | Webhook from backend for SL moves |
| AI Assistant | `n8n/workflows/ai-assistant.json` | User questions → Ollama → reply |

**n8n is SAFETY ONLY** — no strategy logic inside n8n.

---

## 8. AI Model Recommendations (Free / Self-Hosted on Kali)

### Recommended Stack (100% Free)

| Component | Tool | Why |
|-----------|------|-----|
| LLM | **Ollama** + **Qwen2.5:7b-instruct** or **Llama 3.1 8B** | Best free local models for reasoning + JSON |
| Embeddings | **nomic-embed-text** (via Ollama) | Store trade lessons as vectors |
| Vector DB | **pgvector** (Supabase extension) OR **ChromaDB** on Kali | Semantic search over past trades |
| Orchestration | n8n → HTTP to Ollama API | Already in your stack |

### Alternative Models (by RAM)

| RAM Available | Model | Use Case |
|---------------|-------|----------|
| 8 GB | `qwen2.5:3b` | Basic Q&A, lightweight |
| 16 GB | `qwen2.5:7b-instruct` | **Recommended** — trade analysis |
| 32 GB+ | `llama3.1:70b` or `qwen2.5:14b` | Deep analysis, better reasoning |

### What the AI Agent Does

1. **After each closed trade:** Backend writes a `trade_lesson` → embedded → stored
2. **Before new signal:** Query similar past setups → adjust confidence note
3. **Telegram Q&A:** "Which pair works best for my strategy?" → queries `pair_stats` + memory
4. **Learning loop:** Win/loss patterns update `pair_stats.strategy_score`

### AI System Prompt (stored in `ai-agent/prompts/trading-assistant.txt`)

```
You are a crypto trading assistant for an SMC-based futures system.
You ONLY answer using data from the database: trades, signals, pair_stats, trade_lessons.
Never invent prices or signals. If data is missing, say so.
Focus on top-20 pairs. Reference specific trade IDs when giving lessons.
Be concise. Use bullet points for Telegram replies.
```

---

## 9. Folder Structure

```
crypto-trading/
├── docs/PLANNING.md              ← This file
├── supabase/migrations/          ← SQL schema
├── backend/                        ← Node.js Express + Strategy Engine
├── frontend/                       ← React dashboard
├── n8n/workflows/                  ← Importable JSON + README
├── ai-agent/                       ← Ollama setup, prompts, docker-compose
└── pinscript.txt                   ← Reference Pine Script (source logic)
```

---

## 10. Build Phases

### Phase 1 — Foundation ✅ (Current)
- [x] Planning document
- [ ] Supabase schema
- [ ] Backend scaffold + Binance connection
- [ ] Basic strategy engine (EMA, RSI, simplified SMC)

### Phase 2 — Strategy Brain
- [ ] Full SMC port (BOS, CHoCH, OB, liquidity sweep)
- [ ] Multi-timeframe analyzer (1H → 30M → 15M → 5M)
- [ ] Signal engine with confidence scoring
- [ ] Risk manager

### Phase 3 — Dashboard
- [ ] Lightweight Charts with candles + EMA overlays
- [ ] RSI panel, OB zones, BOS/CHoCH markers
- [ ] Signals list, trades panel, performance stats

### Phase 4 — Execution Layer
- [ ] n8n workflows (importable JSON)
- [ ] Telegram bot with BUY NOW / SKIP
- [ ] Position monitor (auto SL/TP/trailing)

### Phase 5 — AI Memory
- [ ] Ollama on Kali setup guide
- [ ] Trade lesson pipeline
- [ ] Telegram Q&A via n8n → Ollama

---

## 11. Environment Variables

See `.env.example` in each folder. Required keys:

```
# Backend
PORT=3001
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
BINANCE_API_KEY=
BINANCE_API_SECRET=
BINANCE_TESTNET=true
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
N8N_WEBHOOK_URL=
COINGECKO_API_KEY=          # optional

# Frontend
VITE_API_URL=http://localhost:3001
VITE_WS_URL=ws://localhost:3001

# n8n
BACKEND_URL=http://your-backend:3001
OLLAMA_URL=http://kali-server:11434
```

---

## 12. Important Rules (Never Break)

1. ❌ Never trade without OB retest confirmation
2. ❌ Never trade coins with >30% daily move
3. ❌ Never auto-enter — always manual Telegram confirm
4. ✅ Always enforce 1% risk, 3% daily max loss
5. ✅ Always auto-manage SL/TP after entry
6. ✅ Always log every operation to database
7. ✅ n8n validates before ANY Binance order
8. ✅ Notify only on high-confidence setups (≥70%) — quality over quantity

---

## 13. Telegram Message Format

```
🎯 SIGNAL — BTCUSDT
Direction: LONG
Confidence: 82/100

📊 Breakdown:
• EMA: Price > EMA100 ✓
• RSI: 38 (normal + OB confirm) ✓
• SMC: BOS bullish on 1H ✓
• OB: Demand retest on 15M ✓
• Volatility: +2.1% daily ✓

Entry: 67,450
SL: 66,980 (below OB)
TP1: 67,920 (1R)
TP2: 68,390 (2R)
TP3: Trailing

MTF: 1H✓ → 30M✓ → 15M OB✓ → 5M entry✓

[BUY NOW]  [SKIP]
```

---

## 14. Next Steps

1. Run Supabase migration
2. Configure `backend/.env`
3. Start backend: `cd backend && npm install && npm run dev`
4. Start frontend: `cd frontend && npm install && npm run dev`
5. Import n8n workflows from `n8n/workflows/`
6. Setup Ollama on Kali (see `ai-agent/README.md`)
