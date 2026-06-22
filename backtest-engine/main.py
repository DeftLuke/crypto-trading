#!/usr/bin/env python3
"""
TradeGPT E5 Institutional Backtesting Engine (CLI)

Data: reuses research-platform SyncEngine output (Parquet + PostgreSQL).
      DO NOT use CCXT here — run sync first:

  curl -X POST http://localhost:8100/sync/batch \\
    -H 'Content-Type: application/json' \\
    -d '{"symbols":["BTCUSDT","ETHUSDT"],"timeframes":["5m","15m","1h","4h"]}'

Production backtests: use research-platform POST /backtest/start with
strategy_name=E5_INSTITUTIONAL_V1 (dashboard: /backtests)
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

# Ensure package root is on path when run as script
ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backtest.engine import BacktestEngine
from backtest.metrics import compute_metrics
from backtest.optimizer import optimize_parameters
from backtest.reports import (
    export_app_payload,
    plot_drawdown,
    plot_equity_curve,
    save_summary_json,
    save_trades_csv,
)
from config.settings import load_settings
from data.downloader import load_all_data
from strategies.tradegpt_e5 import build_feature_frame, generate_signals, signals_to_dataframe

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("main")


def print_summary(summary, symbol: str) -> None:
    border = "=" * 56
    print(f"\n{border}")
    print(f"  TradeGPT E5 Backtest — {symbol}")
    print(border)
    print(f"  Total Trades     : {summary.total_trades}")
    print(f"  Winning / Losing : {summary.winning_trades} / {summary.losing_trades}")
    print(f"  Win Rate         : {summary.win_rate}%")
    print(f"  Profit Factor    : {summary.profit_factor}")
    print(f"  Net Profit       : ${summary.net_profit:,.2f} ({summary.net_profit_pct}%)")
    print(f"  Max Drawdown     : ${summary.max_drawdown:,.2f} ({summary.max_drawdown_pct}%)")
    print(f"  Sharpe Ratio     : {summary.sharpe_ratio}")
    print(f"  Average R        : {summary.average_rr}R")
    print(f"  Final Balance    : ${summary.final_balance:,.2f}")
    print(f"{border}\n")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="TradeGPT E5 Binance Futures Backtester")
    p.add_argument("--symbol", default="BTCUSDT", help="Primary symbol to backtest")
    p.add_argument("--htf", default="4h", help="Higher timeframe for trend")
    p.add_argument("--ltf", default="15m", help="Lower timeframe for entries")
    p.add_argument("--balance", type=float, default=10_000.0)
    p.add_argument("--leverage", type=float, default=10.0)
    p.add_argument("--risk", type=float, default=0.01, help="Risk per trade (0.01 = 1%%)")
    p.add_argument("--fee", type=float, default=0.0004)
    p.add_argument("--slippage", type=float, default=0.0005)
    p.add_argument("--force-download", action="store_true")
    p.add_argument("--optimize", action="store_true", help="Run EMA/ATR grid search")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    settings = load_settings(
        primary_symbol=args.symbol,
        htf=args.htf,
        ltf=args.ltf,
        entry_timeframe=args.ltf,
        initial_balance=args.balance,
        leverage=args.leverage,
        risk_per_trade=args.risk,
        fee_rate=args.fee,
        slippage_pct=args.slippage,
        run_optimization=args.optimize,
    )

    logger.info("Loading market data for %s…", settings.symbols)
    try:
        data = load_all_data(settings, force=args.force_download)
    except Exception as exc:
        logger.error("Data load failed: %s", exc)
        return 1

    symbol = args.symbol.upper()
    if symbol not in data:
        logger.error("Symbol %s not in configured list: %s", symbol, settings.symbols)
        return 1

    ltf_df = data[symbol][settings.ltf]
    htf_df = data[symbol][settings.htf]
    logger.info("LTF %s: %d bars | HTF %s: %d bars", settings.ltf, len(ltf_df), settings.htf, len(htf_df))

    if args.optimize:
        logger.info("Running parameter optimization…")
        opt = optimize_parameters(ltf_df, htf_df, settings)
        settings.ema_fast = opt.best_params.get("ema_fast", settings.ema_fast)
        settings.ema_mid = opt.best_params.get("ema_mid", settings.ema_mid)
        settings.atr_period = opt.best_params.get("atr_period", settings.atr_period)
        opt_path = settings.reports_dir / f"optimization_{symbol}.json"
        opt_path.write_text(json.dumps({"best": opt.best_params, "trials": opt.trials}, indent=2))
        logger.info("Optimization report → %s", opt_path)

    features = build_feature_frame(ltf_df, htf_df, settings)
    signals = generate_signals(features, settings)
    signal_df = signals_to_dataframe(signals)
    if not signal_df.empty:
        sig_path = settings.reports_dir / f"signals_{symbol}.csv"
        signal_df.to_csv(sig_path, index=False)
        logger.info("Signals saved → %s (%d rows)", sig_path, len(signal_df))

    engine = BacktestEngine(settings)
    result = engine.run(features, signals)
    summary = compute_metrics(result)

    print_summary(summary, symbol)

    save_trades_csv(result, settings, symbol)
    app_payload = export_app_payload(summary, symbol, settings)
    save_summary_json(summary, settings, symbol, extra={"app_import": app_payload, "optimization": args.optimize})
    plot_equity_curve(result, settings, symbol)
    plot_drawdown(result, settings, symbol)

    import_path = settings.reports_dir / f"app_import_{symbol}.json"
    import_path.write_text(json.dumps(app_payload, indent=2), encoding="utf-8")
    logger.info("App import payload → %s", import_path)
    logger.info("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
