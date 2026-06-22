"""
Programmatic API for TradeGPT app integration.

Example (from repo root):
    from backtest_engine.integrate import run_e5_backtest  # if installed as package
Or:
    python -c "from integrate import run_e5_backtest; print(run_e5_backtest('BTCUSDT'))"

Returns dict compatible with POST /api/backtest/import on the Node backend.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backtest.engine import BacktestEngine
from backtest.metrics import compute_metrics
from backtest.reports import export_app_payload, plot_drawdown, plot_equity_curve, save_summary_json, save_trades_csv
from config.settings import load_settings
from data.provider import load_candles
from data.processor import prepare_ohlcv
from strategies.tradegpt_e5 import build_feature_frame, generate_signals


def run_e5_backtest(
    symbol: str = "BTCUSDT",
    htf: str = "4h",
    ltf: str = "15m",
    *,
    save_reports: bool = True,
    force_download: bool = False,
    **settings_overrides: Any,
) -> dict[str, Any]:
    """
    Run full E5 pipeline for one symbol and return metrics + app import payload.
    """
    settings = load_settings(
        primary_symbol=symbol.upper(),
        htf=htf,
        ltf=ltf,
        entry_timeframe=ltf,
        **settings_overrides,
    )

    ltf_raw = load_candles(symbol.upper(), ltf)
    htf_raw = load_candles(symbol.upper(), htf)
    if ltf_raw is None or htf_raw is None:
        raise FileNotFoundError(f"No synced data for {symbol} — run research-platform /sync/batch first")
    ltf_df = prepare_ohlcv(ltf_raw)
    htf_df = prepare_ohlcv(htf_raw)

    features = build_feature_frame(ltf_df, htf_df, settings)
    signals = generate_signals(features, settings)
    result = BacktestEngine(settings).run(features, signals)
    summary = compute_metrics(result)
    payload = export_app_payload(summary, symbol.upper(), settings)

    if save_reports:
        save_trades_csv(result, settings, symbol.upper())
        save_summary_json(summary, settings, symbol.upper(), extra={"app_import": payload})
        plot_equity_curve(result, settings, symbol.upper())
        plot_drawdown(result, settings, symbol.upper())

    return {
        "ok": True,
        "summary": summary.to_dict(),
        "app_import": payload,
        "signal_count": len(signals),
        "trade_count": len(result.trades),
    }


if __name__ == "__main__":
    sym = sys.argv[1] if len(sys.argv) > 1 else "BTCUSDT"
    out = run_e5_backtest(sym)
    print(json.dumps(out["app_import"], indent=2))
