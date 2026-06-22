"""Save trades, JSON summary, and matplotlib charts."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd

from backtest.engine import BacktestResult
from backtest.metrics import PerformanceSummary, compute_metrics, trades_to_dataframe
from config.settings import Settings

logger = logging.getLogger(__name__)


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")


def save_trades_csv(result: BacktestResult, settings: Settings, symbol: str) -> Path:
    path = settings.reports_dir / f"trades_{symbol}_{_stamp()}.csv"
    df = trades_to_dataframe(result.trades)
    df.to_csv(path, index=False)
    logger.info("Trades saved → %s", path)
    return path


def save_summary_json(
    summary: PerformanceSummary,
    settings: Settings,
    symbol: str,
    extra: dict | None = None,
) -> Path:
    path = settings.reports_dir / f"summary_{symbol}_{_stamp()}.json"
    payload = {
        "strategy": "TradeGPT E5",
        "symbol": symbol,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "metrics": summary.to_dict(),
        "config": {
            "htf": settings.htf,
            "ltf": settings.ltf,
            "risk_per_trade": settings.risk_per_trade,
            "leverage": settings.leverage,
            "fee_rate": settings.fee_rate,
            "slippage_pct": settings.slippage_pct,
            "ema_fast": settings.ema_fast,
            "ema_mid": settings.ema_mid,
            "ema_slow": settings.ema_slow,
            "atr_period": settings.atr_period,
        },
        **(extra or {}),
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    logger.info("Summary saved → %s", path)
    return path


def plot_equity_curve(result: BacktestResult, settings: Settings, symbol: str) -> Path:
    path = settings.charts_dir / f"equity_{symbol}_{_stamp()}.png"
    eq = pd.DataFrame(result.equity_curve)
    if eq.empty:
        logger.warning("No equity data to plot")
        return path

    fig, ax = plt.subplots(figsize=(12, 5))
    ax.plot(eq["datetime"], eq["equity"], color="#10b981", linewidth=1.2)
    ax.set_title(f"Equity Curve — {symbol} (TradeGPT E5)")
    ax.set_xlabel("Date")
    ax.set_ylabel("Equity (USDT)")
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)
    logger.info("Equity chart → %s", path)
    return path


def plot_drawdown(result: BacktestResult, settings: Settings, symbol: str) -> Path:
    path = settings.charts_dir / f"drawdown_{symbol}_{_stamp()}.png"
    eq = pd.DataFrame(result.equity_curve)
    if eq.empty:
        return path

    series = eq["equity"].astype(float)
    peak = series.cummax()
    dd_pct = (peak - series) / peak.replace(0, float("nan")) * 100

    fig, ax = plt.subplots(figsize=(12, 4))
    ax.fill_between(eq["datetime"], dd_pct, 0, color="#ef4444", alpha=0.5)
    ax.set_title(f"Drawdown — {symbol} (TradeGPT E5)")
    ax.set_xlabel("Date")
    ax.set_ylabel("Drawdown %")
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)
    logger.info("Drawdown chart → %s", path)
    return path


def export_app_payload(summary: PerformanceSummary, symbol: str, settings: Settings) -> dict:
    """JSON shape compatible with TradeGPT backend backtest import."""
    return {
        "strategy_id": "tradegpt-e5",
        "symbol": symbol,
        "timeframe": settings.ltf,
        "source": "native",
        "run_name": f"E5 {symbol} {settings.ltf}",
        "total_trades": summary.total_trades,
        "wins": summary.winning_trades,
        "losses": summary.losing_trades,
        "win_rate": summary.win_rate,
        "profit_factor": summary.profit_factor,
        "total_pnl": summary.net_profit,
        "return_pct": summary.net_profit_pct,
        "max_drawdown": summary.max_drawdown_pct,
        "sharpe": summary.sharpe_ratio,
        "avg_r_multiple": summary.average_rr,
    }
