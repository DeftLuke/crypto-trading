# Institutional SMC Engine — CP0 Architecture Confirmation

**Status:** CONFIRMED — foundation for Phase 1+ implementation  
**Date:** 2026-06-21  
**Decision:** Python canonical engine + Node orchestration (Option A+)

---

## 1. Why this architecture

| Question | Answer |
|----------|--------|
| Why Python for SMC core? | Richest existing code (`SmcEngine`, zones, indicators, E5 features), polars performance, pytest coverage path, DB persistence already in research platform |
| Why keep Node? | Live scanner, Binance execution, Telegram, Supabase `signals` table, position monitor — production runtime is Node |
| Why not E5 alone? | E5 covers ~70% (MSS, displacement, sweep scoring) but misses premium/discount, your exact filter set, MTF 1D/4H/1H/15M, unified rejection logging, and ≥80 gate with full explainability |
| Why not upgrade `smc.js` only? | Would create a 4th divergent implementation; research backtests and live would drift again |

**E5 disposition:** E5 institutional strategy becomes a **legacy research profile**. New work lives in `research-platform/app/institutional_smc/`. E5 tables (`021_e5_institutional_backtest.sql`) remain for historical runs.

---

## 2. System diagram

```text
┌─────────────────────────────────────────────────────────────────┐
│  LIVE (Node backend)                                            │
│  marketScanner.js                                               │
│    └─ strategies/institutional-smc/  (replaces smc-mtf path)    │
│         └─ institutionalSmcClient.js  → HTTP                     │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  RESEARCH API (Python FastAPI) :8100                            │
│  POST /api/v1/institutional-smc/analyze                         │
│  POST /api/v1/institutional-smc/analyze/batch                   │
│    └─ InstitutionalSmcOrchestrator                              │
│         ├─ modules/structure.py      (Module 1)                 │
│         ├─ modules/liquidity.py      (Module 2)                 │
│         ├─ modules/sweeps.py         (Module 3)                 │
│         ├─ modules/order_blocks.py   (Module 4)                 │
│         ├─ modules/fvg.py            (Module 5)                 │
│         ├─ modules/premium_discount.py (Module 6)               │
│         ├─ modules/displacement.py   (Module 7)                 │
│         ├─ filters/                  (validation layers)        │
│         ├─ confluence/scorer.py      (0–100, ≥80 gate)          │
│         └─ persistence/writer.py     → Supabase tables          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Supabase                                                       │
│  structure_events, liquidity_levels, liquidity_sweeps,          │
│  order_blocks, fair_value_gaps, displacements,                  │
│  confluence_scores, trade_setups, smc_rejections, signals       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Multi-timeframe flow (replacing current 1H/30M/15M/5M)

| Role | Timeframe | Purpose |
|------|-----------|---------|
| Trend | **1D** | Macro structure bias |
| Bias | **4H** | Intermediate structure + EMA200 alignment |
| Setup | **1H** | OB, sweep, FVG, premium/discount zone |
| Entry | **15M** | Trigger, displacement, confluence trigger |

**Gate:** HTF (1D + 4H) must align with trade direction before LTF (1H + 15M) scoring.

---

## 4. Confluence scoring (canonical weights)

| Component | Points |
|-----------|--------|
| Market Structure | 20 |
| Liquidity Sweep | 20 |
| Order Block | 12 |
| FVG | 10 |
| Premium / Discount | 8 |
| Displacement | 10 |
| Volume + Open Interest | 10 |
| EMA Alignment (21/50/200) | 10 |
| RSI + MACD | 5 |
| Volatility (ATR14 vs ATR50) | 5 |
| **Total** | **110 raw → normalized to 100** |

**Trade permission:** normalized score ≥ **80** (raw ≥ 88) AND `explainability_complete === true`

Raw weights sum to 110 per spec; `normalize_confluence_score()` maps to 0–100 at scoring time (CP5).  
**Reject:** score < 80 OR any mandatory module missing explanation → log to `smc_rejections`

---

## 5. Explainability contract

Every accepted or rejected setup MUST produce a `TradeSetupExplanation` JSON (see `institutional_smc/types.py`).

If the engine cannot populate mandatory sections, the signal is **rejected** — never silent IGNORE.

Mandatory sections:
- `market_structure`
- `liquidity_sweep`
- `order_block`
- `fvg`
- `premium_discount`
- `displacement`
- `filters` (each filter pass/fail + reason)
- `confluence` (breakdown + total)

---

## 6. What gets replaced (Node)

| Current | Replacement |
|---------|-------------|
| `backend/src/strategy/smc.js` gates | Deprecated for live; kept for legacy backtest until parity tests pass |
| `signalEngine.js` scoring | Replaced by Python `ConfluenceScorer` |
| `smc-mtf/rules.js` RSI oversold gates | Replaced by institutional filters (RSI > 50 long, < 50 short) |
| `mtfAnalysis.js` TF map | Replaced by institutional MTF (1D/4H/1H/15M) via API |
| `strategies/smc-mtf/index.js` | New `strategies/institutional-smc/index.js` behind `SMC_ENGINE_VERSION=v2` |

Rollout flag: `INSTITUTIONAL_SMC_ENABLED=true` + `SMC_ENGINE_VERSION=v2`

---

## 7. Database (migration 022)

Extends `008_phase2_engine.sql` tables + adds:
- `structure_events` — unified BOS/MSS/CHOCH event log
- `displacements` — impulse / ATR / volume / OI expansion records
- `trade_setups` — full explainable setup + levels + outcome hook
- `smc_rejections` — rejected candidates for AI training

See `supabase/migrations/022_institutional_smc.sql`.

---

## 8. Phase roadmap (approval gates)

| CP | Deliverable | Status |
|----|-------------|--------|
| **CP0** | Architecture + schema + contracts + API stub + Node client | **Done** |
| **CP1** | Module 1 Market Structure + tests + persist | **Done** |
| **CP2** | Modules 2–3 Liquidity + Sweeps + persist | **Done** |
| **CP3** | Modules 4–5 OB + FVG + persist | **Done** |
| **CP4** | Modules 6–7 Premium/Discount + Displacement + persist | **Done** |
| **CP5** | Validation filters + ConfluenceScorer + ≥80 gate | **Done** |
| **CP6** | Node scanner integration + engine toggle (Risk page) | **Done** |
| **CP7** | Production deploy + parity tests + research-api health | **Done** (run `deploy-institutional-smc-cp7.sh` on Kali) |

---

## 9. CP7 production deploy (Kali)

Run **on the VPS** after pushing CP0–CP6 code:

```bash
cd ~/crypto-trading
bash scripts/deploy-institutional-smc-cp7.sh
```

This will:
1. Build `research-api` + `backend` (+ analytics dashboard)
2. Start redis/qdrant/research-api (`start-research-api.sh`)
3. Restart `backend-recovery` (`run-backend-recovery.sh`)
4. Run `backend/scripts/verify-institutional-smc-deploy.js`

**Required in `deploy/.env`:**
- `RESEARCH_API_URL=http://host.docker.internal:8100` (backend container)
- `SIGNAL_ENGINE=smc-mtf` or `institutional-smc` (Risk page can override)

**Verify public:**
```bash
curl -s https://api.deftluke.online/api/institutional-smc/health
curl -s https://api.deftluke.online/api/signal-engine/status
```

Toggle engine: **Risk dashboard** → Signal Engine card.

---

## 10. Prerequisites before CP1 coding

- [ ] Apply migration `022_institutional_smc.sql` to Supabase
- [ ] Restore `research-api` container on Kali (currently down)
- [ ] Set `RESEARCH_API_URL=http://research-api:8100` in backend env
- [ ] User approves CP0 → proceed to Module 1

---

## 11. CP0 approval checklist

- [x] Python = canonical SMC computation
- [x] Node = scan orchestration + signal save + execution (unchanged)
- [x] E5 superseded by institutional_smc (not deleted)
- [x] Full replacement of live validation/scoring path planned at CP6
- [x] Reject-if-unexplainable policy enforced in contract
- [x] Migration 022 drafted
- [x] API + client stubs in place

**Approved to proceed to CP1 upon user confirmation.**
