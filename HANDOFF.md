# Crypto Trading — Work Handoff (2026-06-23)

Session goal: observe the full system, fix the highest-impact issues (signals, trailing SL,
dashboard speed, AI footprint, Telegram execution), and stabilise the live server.

---

## 1. TL;DR status

| # | Item | Code | Live on server | Notes |
|---|------|------|----------------|-------|
| 0 | **"No signals since yesterday"** | n/a | ✅ FIXED & VERIFIED | Wrong `RESEARCH_API_URL` in backend container. Scanner now analyzes 178/199 pairs. |
| 1 | Signal-engine resilience (alert + don't abort scan) | ✅ done | ⏳ needs deploy | Offline Telegram alert + batch-failure no longer aborts whole scan. |
| 2 | Trailing SL engine (real bugs) | ✅ done | ⏳ needs deploy + migration 025 | `peak_price` now persists; failures escalate + alert + verify on exchange. |
| 3 | Dashboard speed (N+1 + polling) | ✅ done | ⏳ needs deploy | Closed-trade lists skip Binance; smaller queries; staleTime; slower polling. |
| 4 | Ollama → OpenClaw-first | ✅ done | ✅ env live (`OLLAMA_ENABLED=false`) | Code (OpenClaw-first routing) still needs deploy. |
| 5 | Telegram gap + audit-trail API | ✅ done | ⏳ needs deploy | Fail-safe dual-source auto-trade gate; new `/trades/:id/audit`. |

**Open positions at time of work: NONE** (verified `[]`), so the backend restart was zero-risk.

---

## 2. ROOT CAUSE of "no signals" (fixed live)

- Backend runs in container **`backend-recovery`** (image `crypto-trading-backend:latest`, `--restart always`, host port `127.0.0.1:3002` → container `3001`).
- The **research/SMC engine runs as a host PM2 process on `:8100`** (NOT a docker container — there is no `research-api` container).
- The container had `RESEARCH_API_URL=http://research-api:8100` — a dead Docker hostname → every scan logged `[Scanner] Institutional engine offline: fetch failed` / `Batch analyze failed: fetch failed` → **0 signals**.
- Engine itself was healthy the whole time: `GET /api/v1/institutional-smc/health` → `{"status":"ok","engine_version":"v2",...}`.

### Fix applied live
1. Edited `~/crypto-trading/deploy/.env` (backup: `deploy/.env.bak-20260623-090900`):
   - `RESEARCH_API_URL=http://host.docker.internal:8100`
   - added `OLLAMA_ENABLED=false`
2. Recreated `backend-recovery` **identically** (preserved both bind mounts — `deploy/keys` ro and `backend/data` rw, so `control-settings.json` / trading mode unchanged), only env corrected. Method: dumped container env → `/tmp/be.env`, fixed the one var, `docker run` with same network (`crypto-trading_trading`), ports, dns, `--add-host=host.docker.internal:host-gateway`, both mounts.
3. Verified: container `healthy`, `RESEARCH_API_URL=http://host.docker.internal:8100`, scanner analyzed **178/199 pairs in 63s**. "0 signals" is now just the min-score-80 strategy bar, not an outage.

> NOTE: this fix is **live on the running container** but the underlying `deploy/.env` is also fixed, so it survives a normal recreate. See "Latent issues" for the reboot caveat.

---

## 3. Files changed (local, uncommitted — need deploy)

```
 analytics-dashboard/src/hooks/useQueries.ts |  9 +++-
 backend/src/jobs/marketScanner.js           | 37 ++++-
 backend/src/jobs/positionMonitor.js         | 71 ++++++--
 backend/src/routes/api.js                   | 28 ++-
 backend/src/services/aiAgent.js             | 13 +-
 backend/src/services/ollama.js              | 21 ++
 backend/src/services/supabase.js            | 18 +-
 backend/src/services/telegramInbox.js       | 12 +-
 deploy/.env.example                         |  4 +
 supabase/migrations/025_trailing_peak_price.sql  (NEW)
```

### What each change does
- **positionMonitor.js** — Trailing SL: persist `peak_price` every tick (was written to a non-existent column → trail reset to entry each cycle); on reposition failure, escalate to error + Telegram alert + retry next cycle (was silently swallowed); verify the stop actually exists on the exchange after repositioning (`verifyExchangeProtection`), else alert "Runner UNPROTECTED". Added `sendAlert` import.
- **marketScanner.js** — When engine offline: Telegram alert once + re-nag every 30 min + "back online" notice (was silent). Batch-analyze failure now **skips the batch and continues** (bails only after 5 fails) instead of aborting the whole scan.
- **supabase.js** — `peak_price` added to `TRADE_COLUMNS`; `updateTrade` retries without unknown columns if a migration hasn't run (so SL/TP state never lost); `getTrades` fetches only `limit` closed rows (was 500).
- **ollama.js** — `ollamaGenerate` is now **OpenClaw-first**; `OLLAMA_ENABLED=false` skips Ollama entirely (no 120s hangs); `ollamaEmbed` short-circuits when disabled.
- **aiAgent.js** — Final text fallback degrades gracefully ("assistant temporarily unavailable") instead of throwing if all LLM backends are down. Trading unaffected.
- **telegramInbox.js** — Auto-execute now requires **both** remote control settings AND local control file to agree auto-trading is on / manual-approval off; otherwise falls through to the Telegram approval buttons. Fail-safe (never auto-trades when set off). Added `getLocalControlSettings` import.
- **routes/api.js** — `enrichTrades` skips the Binance round-trip for closed/history lists; new `GET /trades/:id/audit` returns the full per-trade timeline (events + partial closes — data already recorded, just wasn't exposed).
- **useQueries.ts** — `staleTime` added; trades polling 5s → 15s; default trades limit 500 → 200 (all heavy pages pass explicit limits, so unaffected).
- **deploy/.env.example** — documents `OLLAMA_ENABLED=false` + OpenClaw-as-primary note.

All 9 JS files pass `node --check`. `.messages.ts.tmp` is a stray temp file (safe to delete, not part of this work).

---

## 4. Migration required (USER WILL RUN MANUALLY)

`supabase/migrations/025_trailing_peak_price.sql`:

```sql
ALTER TABLE trades ADD COLUMN IF NOT EXISTS peak_price DECIMAL(20, 8);
```

- Run against the Supabase Postgres (SQL editor or `psql "$DATABASE_URL"`).
- Without it, trailing SL still works defensively (updateTrade strips the unknown column) but the high-water-mark won't persist, so trailing won't function correctly. **Run this for the trailing-SL fix to take effect.**

---

## 5. Next steps (in order)

1. **Run migration 025** on the database (user doing manually).
2. **Deploy the code changes:**
   ```bash
   # local
   git add -A && git commit -m "Fix signals fallback, trailing SL, dashboard perf, OpenClaw-first, Telegram gate + audit API"
   git push origin master
   # on server (kali@100.110.210.103)
   cd ~/crypto-trading && git pull
   # rebuild + restart the backend-recovery container (no open positions = safe):
   docker compose -f deploy/docker-compose.yml --profile legacy build backend
   #   then recreate backend-recovery from /tmp/be.env spec OR re-run the corrected run cmd
   ```
   > Restart recreates `backend-recovery`; `backend/data` bind mount preserves settings. Re-confirm `RESEARCH_API_URL=http://host.docker.internal:8100` after.
3. **Verify after deploy:** scanner logs show analysis (no `fetch failed`); trailing SL logs `Trail SL →`; dashboard load noticeably faster; `GET /api/trades/:id/audit` returns events.

---

## 6. Latent issues found (NOT yet fixed — flagged)

- **Reboot can spawn TWO backends.** A dormant `crypto-trading-backend-1` (state: Created) exists, and `crontab @reboot` runs `docker compose up -d backend frontend` (would start it) while `backend-recovery` also returns via `--restart always`. Two backends → Telegram 409 polling conflict + possible double execution. **Recommend:** pick ONE backend (either compose-managed `backend` OR `backend-recovery` script), and make the @reboot cron + restart policy consistent. Remove the other.
- **`scripts/run-backend-recovery.sh` is stale/incomplete:** it (a) uses `set -o pipefail` which fails under `sh`, and (b) does NOT mount `backend/data` (the live container does). Update it to match the live container, or it will create a different container than what's running.
- **Intermittent engine slowness:** the host PM2 engine occasionally times out on 25-symbol batches. The scanner resilience fix handles it (skip + continue). If it persists, lower `INSTITUTIONAL_SMC_BATCH_SIZE` (25 → 10) in `.env`.
- **Bigger architectural asks** the user raised (separate, future): swap Binance for another exchange with proper risk; full audit-trail UI (data + API now exist, needs frontend); self-hosted Postgres if Supabase free tier is outgrown; DEX/web3 trading; self-learning strategy; Polymarket arbitrage bot.

---

## 7. Server access notes (for future sessions)

- SSH: `ssh kali@100.110.210.103` (key auth works).
- **IMPORTANT:** multi-line output stalls over this link unless you disable connection sharing:
  `ssh -n -o ControlPath=none -o BatchMode=yes -o ConnectTimeout=15 kali@100.110.210.103 '<cmd>' < /dev/null`
- Repo on server: `~/crypto-trading`. Deploy dir: `~/crypto-trading/deploy`. Stack: `docker compose` in deploy dir.
- Running containers: `backend-recovery` (backend), `crypto-trading-redis-1`, `crypto-trading-qdrant-1`, `n8n-n8n-1`. Engine: host PM2 on `:8100`. AI gateway: `ai-agent.service` (systemd) on `:8080`.
