# Phase 7 — Paper Trading Engine

Real-time paper trading that mirrors the future live engine (Phase 8) using virtual capital.

## Workflow

```
Signal (Phase 2 / Phase 6 / Dashboard)
    ↓
Risk Validation
    ↓
Position Sizing (margin %, leverage fallback 50→25→20→10→5)
    ↓
Execution Simulator (slippage, spread, latency)
    ↓
Open Position → Real-time monitoring (Binance WS)
    ↓
TP / SL / Trailing Stop
    ↓
Close → Journal + Analytics
    ↓
Validation → Approval for Phase 8
    ↓
Memory feedback (Phase 5) + AI learning (Phase 6)
```

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/paper/start` | Start engine + market feed |
| POST | `/paper/stop` | Stop engine |
| POST | `/paper/order` | Submit signal → open position |
| POST | `/paper/close` | Close / partial close |
| POST | `/paper/move-sl` | Move stop loss |
| POST | `/paper/move-tp` | Move take profit |
| GET | `/paper/accounts` | Paper accounts |
| GET | `/paper/positions` | Open positions |
| GET | `/paper/trades` | Trade journal |
| GET | `/paper/performance` | Analytics (session, symbol, strategy) |
| GET | `/paper/strategies` | Strategy metrics |
| GET | `/paper/approvals` | Validation + approval queue |
| GET | `/paper/risk` | Risk status |
| GET | `/paper/portfolio` | Portfolio snapshot |
| GET | `/paper/dashboard` | Phase 4 bundle |
| WS | `/paper/ws` | Real-time updates |

## Strategy Promotion

```
Research → Backtest → Paper Trading → Validation → Approval → Live (Phase 8)
```

Default validation rules:
- Min 100 trades
- Profit Factor ≥ 1.5
- Sharpe ≥ 1.2
- Max Drawdown ≤ 20%

## Configuration

```env
PAPER_DEFAULT_BALANCE=1000
PAPER_DEFAULT_LEVERAGE=50
PAPER_MAX_DAILY_LOSS_PCT=3.0
PAPER_SLIPPAGE_BPS=5.0
PAPER_VALIDATION_MIN_TRADES=100
```

## Quick Start

```bash
curl -X POST http://localhost:8100/paper/start

curl -X POST http://localhost:8100/paper/order \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSDT","direction":"SHORT","confidence":91,"entry":102500,"sl":103000,"tp1":102000,"strategy_name":"SMC_MTF_V1"}'

curl http://localhost:8100/paper/dashboard
```

## Phase 8 Compatibility

Paper order/position/trade schemas mirror live trading tables. Approved strategies in `strategy_approvals` are live-trading candidates.
