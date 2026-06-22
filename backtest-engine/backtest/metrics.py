"""Performance metrics for backtest results."""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd

from backtest.engine import BacktestResult, ClosedTrade


@dataclass
class PerformanceSummary:
    total_trades: int
    winning_trades: int
    losing_trades: int
    win_rate: float
    profit_factor: float
    net_profit: float
    net_profit_pct: float
    max_drawdown: float
    max_drawdown_pct: float
    sharpe_ratio: float
    average_rr: float
    gross_profit: float
    gross_loss: float
    initial_balance: float
    final_balance: float

    def to_dict(self) -> dict:
        return asdict(self)


def compute_metrics(result: BacktestResult) -> PerformanceSummary:
    trades = result.trades
    initial = result.initial_balance
    final = result.final_balance
    net = final - initial

    wins = [t for t in trades if t.pnl > 0]
    losses = [t for t in trades if t.pnl <= 0]
    gross_profit = sum(t.pnl for t in wins)
    gross_loss = abs(sum(t.pnl for t in losses))
    pf = gross_profit / gross_loss if gross_loss > 0 else (float("inf") if gross_profit > 0 else 0.0)

    equity = pd.DataFrame(result.equity_curve)
    max_dd = 0.0
    max_dd_pct = 0.0
    sharpe = 0.0
    if not equity.empty:
        eq = equity["equity"].astype(float)
        peak = eq.cummax()
        dd = peak - eq
        max_dd = float(dd.max())
        max_dd_pct = float((dd / peak.replace(0, np.nan)).max() * 100) if peak.max() > 0 else 0.0
        returns = eq.pct_change().dropna()
        if len(returns) > 1 and returns.std() > 0:
            sharpe = float(returns.mean() / returns.std() * math.sqrt(252 * 24 * 4))  # ~15m bars annualized

    rr_values = [t.r_multiple for t in trades if t.r_multiple is not None]
    avg_rr = float(np.mean(rr_values)) if rr_values else 0.0

    total = len(trades)
    win_count = len(wins)
    loss_count = len(losses)

    return PerformanceSummary(
        total_trades=total,
        winning_trades=win_count,
        losing_trades=loss_count,
        win_rate=round((win_count / total * 100) if total else 0.0, 2),
        profit_factor=round(pf, 4) if math.isfinite(pf) else 999.0,
        net_profit=round(net, 2),
        net_profit_pct=round((net / initial * 100) if initial else 0.0, 2),
        max_drawdown=round(max_dd, 2),
        max_drawdown_pct=round(max_dd_pct, 2),
        sharpe_ratio=round(sharpe, 4),
        average_rr=round(avg_rr, 4),
        gross_profit=round(gross_profit, 2),
        gross_loss=round(gross_loss, 2),
        initial_balance=initial,
        final_balance=round(final, 2),
    )


def trades_to_dataframe(trades: list[ClosedTrade]) -> pd.DataFrame:
    if not trades:
        return pd.DataFrame(
            columns=[
                "side", "entry_time", "exit_time", "entry_price", "exit_price",
                "quantity", "pnl", "pnl_pct", "fees", "exit_reason", "r_multiple",
            ],
        )
    return pd.DataFrame([asdict(t) for t in trades])
