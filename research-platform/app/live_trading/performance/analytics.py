"""Live trading performance analytics."""

from __future__ import annotations

import math
from collections import defaultdict
from typing import Any

from app.live_trading.types import LiveTrade


class LivePerformanceAnalytics:
    def compute(self, trades: list[LiveTrade]) -> dict[str, Any]:
        if not trades:
            return self._empty()

        pnls = [t.pnl_usd for t in trades]
        wins = [t for t in trades if t.pnl_usd > 0]
        losses = [t for t in trades if t.pnl_usd <= 0]
        win_rate = len(wins) / len(trades) * 100
        gross_win = sum(t.pnl_usd for t in wins) or 0.01
        gross_loss = abs(sum(t.pnl_usd for t in losses)) or 0.01
        pf = gross_win / gross_loss
        returns = [t.pnl_pct / 100 for t in trades if t.pnl_pct]

        return {
            "total_trades": len(trades),
            "win_rate": round(win_rate, 2),
            "profit_factor": round(pf, 3),
            "sharpe_ratio": round(self._sharpe(returns), 3),
            "max_drawdown_pct": round(self._max_drawdown(pnls), 2),
            "net_profit": round(sum(pnls), 4),
            "avg_slippage_bps": round(sum(t.slippage_bps for t in trades) / len(trades), 2),
            "avg_execution_delay_ms": round(sum(t.execution_delay_ms for t in trades) / len(trades), 1),
        }

    def by_strategy(self, trades: list[LiveTrade]) -> dict[str, dict]:
        buckets: dict[str, list[LiveTrade]] = defaultdict(list)
        for t in trades:
            buckets[t.strategy_name].append(t)
        return {k: self.compute(v) for k, v in buckets.items()}

    def by_symbol(self, trades: list[LiveTrade]) -> dict[str, dict]:
        buckets: dict[str, list[LiveTrade]] = defaultdict(list)
        for t in trades:
            buckets[t.symbol].append(t)
        return {k: self.compute(v) for k, v in buckets.items()}

    def _sharpe(self, returns: list[float]) -> float:
        if len(returns) < 2:
            return 0.0
        mean = sum(returns) / len(returns)
        var = sum((r - mean) ** 2 for r in returns) / (len(returns) - 1)
        std = math.sqrt(var) if var > 0 else 0.0
        return mean / std * math.sqrt(252) if std else 0.0

    def _max_drawdown(self, pnls: list[float]) -> float:
        peak = 0.0
        equity = 0.0
        max_dd = 0.0
        for p in pnls:
            equity += p
            peak = max(peak, equity)
            dd = (peak - equity) / peak * 100 if peak else 0
            max_dd = max(max_dd, dd)
        return max_dd

    def _empty(self) -> dict[str, Any]:
        return {
            "total_trades": 0,
            "win_rate": 0,
            "profit_factor": 0,
            "sharpe_ratio": 0,
            "max_drawdown_pct": 0,
            "net_profit": 0,
            "avg_slippage_bps": 0,
            "avg_execution_delay_ms": 0,
        }
