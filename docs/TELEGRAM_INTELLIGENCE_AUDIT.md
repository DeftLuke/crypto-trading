# Telegram Intelligence Audit Layer

## Problem (last 3–4 days)

Trades from 9 VIP Telegram groups were missed or wrong because the pipeline had **no durable audit trail**:

| Stage | What went wrong |
|-------|-----------------|
| **Parse** | Chart-only signals dropped (`acceptable_parsed_signal`), rule parser misses non-standard text, AI `is_signal=false` with no stored reason |
| **Vision** | Chart images never persisted — only `"[attached chart]"` text hint |
| **Group format** | `format_profile` lived in JSON metadata — not queryable, not visible in dashboard |
| **Validation** | Rejects buried in `api_result` JSONB on inbox row — no list of failed rules |
| **Review** | No side-by-side: original message → AI output → validation score |
| **Execution** | Auto-trade could run without human-visible reasoning chain |

Common rejection causes in production:

1. **Signal too old** (>15 min) on scrape/history paths  
2. **Validation score < 60** (SMC confidence, pair stats, lesson penalties)  
3. **Parse skip** — chart-only caption, missing SL/TP in text  
4. **Shape fail** — symbol not `*USDT`, bad LONG/SHORT geometry  
5. **Symbol lock** — open trade on same pair (execution stage — not changed in this phase)

## Solution — 5 modules (audit only, no execution changes)

### Module 1 — `telegram_raw_messages`

Every message stored: text, optional chart (base64), timestamp, `processed_status`.

- **API:** `GET /api/telegram/raw`, `GET /api/telegram/raw/:id`, `GET /api/telegram/raw/:id/image`
- **Backfill:** `POST /api/telegram/archive/recent` → optional slow backfill (**10/msg**, max 20, 1.5s delay). **Live listener archives every new message** — prefer WS over bulk scrape.

### Module 2 — `telegram_group_memory`

Learned patterns per group: keywords, entry/SL/TP format, examples.

- **API:** `GET /api/telegram/group-memory`
- **Sync:** on format learn / source metadata update

### Module 3 — Vision + LLM parser audit

Ingestion sends `audit` block with `ai_output`, `model_used`, `parse_stage` (rule | ai | vision).

- Router: `parse_with_audit()` — stores AI JSON even when `is_signal=false`

### Module 4 — `parsed_signals_raw`

Reviewable AI output with `review_shape`: symbol, direction, entry, sl, tp1–3, confidence, reason.

- **API:** `GET /api/telegram/parsed`

### Module 5 — `telegram_signal_rejections`

Structured rejections: stage, score, `failed_rules[]`, original message, validation blob.

- **API:** `GET /api/telegram/rejected`

## Dashboard

**Telegram Sources → Intelligence Audit** tab:

- Rejections (default — see why trades failed)
- Parsed (AI output)
- Raw archive (text + chart image)
- Group memory

## Signal flow (updated)

```
Telegram group message (live Telethon listener)
  → AI/rule parse (informal: "BSB long from here")
  → Raw archive + audit (every message, no bulk scrape)
  → SMC enrich (entry/SL/TP from engine if group only gives direction)
  → Validate score ≥ 50 (TELEGRAM_MIN_VALIDATION_SCORE)
  → Auto-execute if control auto_trading ON (your risk sizing only)
```

**Group provides:** symbol + direction trust (2–3 years track record)  
**Platform provides:** SL/TP from SMC, validation score, margin/leverage from `telegramTrade` / risk manager  
**Ignored from groups:** leverage %, margin %, "use 3x", etc.

## Deploy

1. Apply migration: `supabase/migrations/023_telegram_intelligence_audit.sql`
2. Restart backend + telegram-signal-service
3. Click **Archive last 50 / group** to backfill raw history
4. Use **Learn format** on each group to populate group memory

## Next phase (not in this PR)

- Require audit review before auto-execute
- Per-group parser tuning from rejection analytics
- Lower false rejects (freshness window, chart-only path, score thresholds)
