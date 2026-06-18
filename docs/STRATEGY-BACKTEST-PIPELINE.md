# Strategy & Backtest Pipeline

Store all strategies and backtest results in **Supabase**, rank them, and promote the best **native crypto** strategy for the live scanner.

## Architecture

```
QuantConnect (research)          TradeGPT native backtest
        │                                  │
        └──────── POST /api/backtest/import ────────┐
                                                    ▼
                                          backtest_runs (scored)
                                                    │
                                          strategy_catalog
                                                    │
                    POST /api/strategies/:id/promote
                                                    ▼
                              Live scanner (smc-mtf or promoted native)
```

## Database tables

| Table | Purpose |
|-------|---------|
| `strategy_catalog` | All strategies (native, QuantConnect, custom) |
| `backtest_runs` | Every backtest result + **score** for ranking |

Run migration on Supabase:

```bash
# Apply supabase/migrations/018_strategy_catalog.sql in SQL editor
```

## 1. Native crypto backtest (TradeGPT)

Already works on **trade.deftluke.online** → Strategy → Backtest, or:

```bash
curl -X POST https://api.deftluke.online/api/backtest \
  -H "Content-Type: application/json" \
  -d '{"strategyId":"smc-mtf","symbol":"BTCUSDT","period":"3m","timeframe":"15m"}'
```

Results auto-save to `backtest_runs` with a composite **score**.

## 2. Import QuantConnect results

After a QC backtest completes, save metrics to JSON (see `quantconnect/examples/import-backtest.example.json`):

```bash
node scripts/import-backtest-result.js quantconnect/examples/import-backtest.example.json
```

Or via API:

```bash
curl -X POST https://api.deftluke.online/api/backtest/import \
  -H "Content-Type: application/json" \
  -d @quantconnect/examples/import-backtest.example.json
```

Fields from your QC screenshot:

- `return_pct` — Return % (e.g. 1238.57)
- `total_pnl` / `net_profit` — Net Profit
- `psr` — Probabilistic Sharpe Ratio
- `external_project_id` — QC project id from URL

## 3. View rankings

```bash
curl https://api.deftluke.online/api/backtest/rankings
curl https://api.deftluke.online/api/backtest/history
curl https://api.deftluke.online/api/strategies/catalog
```

Highest **score** = best candidate.

## 4. Promote best strategy for live trading

**Native strategies** (in codebase, e.g. `smc-mtf`):

```bash
curl -X POST https://api.deftluke.online/api/strategies/smc-mtf/promote
```

This sets `strategy_catalog.status = production` and the **scanner uses it** on the next scan.

**QuantConnect-only strategies** are saved as `candidate` — port the logic to crypto (`AddCrypto`, perps) and register as native before live deployment.

## 5. Check active scanner strategy

```bash
curl https://api.deftluke.online/api/strategies/active
```

## Recommended workflow

1. **Research** on QuantConnect (stocks, futures, or crypto algorithms).
2. **Import** top results → `backtest_runs`.
3. **Backtest crypto** versions on TradeGPT (`smc-mtf`, custom).
4. **Compare** via `/api/backtest/rankings`.
5. **Promote** the winning **native crypto** strategy for demo/live scanner.
6. **Paper trade** on demo before real funds.

## Your current QC project

"Swimming Yellow Dinosaur" (tech momentum, +1238% return) is a **US equity** strategy. Import it for your research library, but the live app scans **Binance crypto futures** — use it as inspiration, then validate `smc-mtf` or a crypto QC algorithm on BTC/ETH perps.
