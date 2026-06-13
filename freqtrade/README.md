# Freqtrade integration for TradeGPT

[Freqtrade](https://github.com/freqtrade/freqtrade) is a popular Python crypto bot (backtesting, dry-run, live trading, hyperopt, FreqUI). It runs **alongside** your Node.js TradeGPT backend — not inside it.

```
┌─────────────────────────────────────────────────────────────┐
│  trade.deftluke.online (React dashboard)                    │
│    ├── Trading / SMC scanner (Node backend)                 │
│    ├── Strategy Tester (Node backtests)                     │
│    └── Freqtrade page ──► Node API ──► Freqtrade REST API   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  freqtrade/ (Python bot, Docker)                            │
│    user_data/strategies/  ← your .py strategies             │
│    user_data/config.json  ← exchange, dry-run, API auth     │
└─────────────────────────────────────────────────────────────┘
```

## Folder layout

```
freqtrade/
├── README.md                          ← this file
├── .env.example                       ← API passwords & strategy name
├── user_data/
│   ├── config.json                    ← bot config (dry-run default)
│   ├── strategies/
│   │   ├── TradeGPT_RSI_Momentum.py   ← RSI + EMA (matches TradeGPT RSI gates)
│   │   └── TradeGPT_EMA_Crossover.py  ← EMA cross long/short
│   ├── logs/                          ← created at runtime
│   └── data/                          ← downloaded OHLCV for backtests
```

## Quick start (Docker on Kali/VPS)

### 1. Configure secrets

```bash
cp freqtrade/.env.example deploy/.env   # if not already
# Edit deploy/.env — set FREQTRADE_* vars (see deploy/.env.example)
```

Set strong values for:
- `FREQTRADE_API_PASSWORD`
- `FREQTRADE_JWT_SECRET` (long random string)

Binance keys are reused from `BINANCE_API_KEY` / `BINANCE_API_SECRET` via Docker env overrides.

### 2. Start Freqtrade

```bash
cd deploy
docker compose --profile freqtrade up -d freqtrade
```

### 3. Verify

```bash
docker compose --profile freqtrade logs -f freqtrade
curl -u freqtrader:YOUR_PASSWORD http://127.0.0.1:8081/api/v1/ping
```

Open **TradeGPT dashboard → Freqtrade** to see status, profit, and open trades.

### 4. FreqUI (optional web UI)

```bash
docker compose --profile freqtrade exec freqtrade freqtrade install-ui
# Then open http://127.0.0.1:8081 (or tunnel ft.deftluke.online)
```

---

## Workflow

### Phase 1 — Dry run (always start here)

1. Keep `"dry_run": true` in `user_data/config.json` (default).
2. Start bot: dashboard **Start** or `docker compose ... up -d freqtrade`.
3. Watch open trades on the Freqtrade page.
4. Use Telegram (optional) — enable in `config.json` with your bot token.

### Phase 2 — Backtest a strategy

Download data, then backtest:

```bash
cd deploy

# Download 3 months of 15m futures data
docker compose --profile freqtrade run --rm freqtrade download-data \
  --exchange binance \
  --pairs BTC/USDT:USDT ETH/USDT:USDT \
  --timeframes 15m 5m \
  --days 90 \
  --trading-mode futures

# Backtest RSI strategy
docker compose --profile freqtrade run --rm freqtrade backtesting \
  --config user_data/config.json \
  --strategy TradeGPT_RSI_Momentum \
  --timerange 20260301-

# List results
docker compose --profile freqtrade run --rm freqtrade backtesting-show
```

### Phase 3 — Hyperopt (optimize parameters)

```bash
docker compose --profile freqtrade run --rm freqtrade hyperopt \
  --config user_data/config.json \
  --strategy TradeGPT_RSI_Momentum \
  --hyperopt-loss SharpeHyperOptLoss \
  --epochs 100 \
  --spaces buy sell
```

### Phase 4 — Live trading (real money)

⚠️ Only after dry-run + backtest look good.

1. Set `FREQTRADE_DRY_RUN=false` in `deploy/.env`.
2. Use **live** Binance API keys with futures permission.
3. Start with small `max_open_trades` and stake.
4. Monitor via dashboard + Telegram `/status`.

---

## Add your own strategy

1. Create `freqtrade/user_data/strategies/MyStrategy.py`
2. Extend `IStrategy` — see [Freqtrade docs](https://www.freqtrade.io/en/stable/strategy-customization/)
3. List strategies:

   ```bash
   docker compose --profile freqtrade run --rm freqtrade list-strategies
   ```

4. Set active strategy in `deploy/.env`:

   ```
   FREQTRADE_STRATEGY=MyStrategy
   ```

5. Restart: `docker compose --profile freqtrade up -d freqtrade`

---

## TradeGPT vs Freqtrade

| Feature | TradeGPT (Node) | Freqtrade (Python) |
|--------|-----------------|---------------------|
| SMC-MTF strategy | ✅ Built-in | ❌ Use custom .py |
| Strategy Tester UI | ✅ Node backtester | ✅ CLI backtesting |
| AI agent / scanner | ✅ | ❌ |
| Hyperopt / FreqAI | ❌ | ✅ |
| Dry-run bot | Scanner only | ✅ Full bot |
| Telegram | ✅ /startT | ✅ Native commands |

**Recommendation:** Keep SMC signals on TradeGPT scanner; use Freqtrade for systematic RSI/EMA bots and heavy backtesting.

---

## Cloudflare tunnel (optional)

Add to `scripts/kali-cloudflared-config.yml`:

```yaml
  - hostname: ft.deftluke.online
    service: http://127.0.0.1:8081
```

Then set `FREQTRADE_PUBLIC_URL=https://ft.deftluke.online` in `deploy/.env`.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Dashboard shows "Freqtrade offline" | `docker compose --profile freqtrade up -d freqtrade` |
| 401 on API | Match `FREQTRADE_API_USER` / `FREQTRADE_API_PASSWORD` with config |
| No trades in dry-run | Check pair whitelist, strategy signals, logs |
| Binance errors | Testnet vs live keys; futures enabled on API key |

Official docs: https://www.freqtrade.io/en/stable/
