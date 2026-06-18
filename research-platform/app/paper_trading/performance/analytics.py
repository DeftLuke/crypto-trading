"""Performance analytics for paper trading."""

from __future__ import annotations

import math
from collections import defaultdict
from typing import Any

from app.paper_trading.types import PaperTrade


class PerformanceAnalytics:
    def compute(self, trades: list[PaperTrade]) -> dict[str, Any]:
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
        sharpe = self._sharpe(returns)
        sortino = self._sortino(returns)
        max_dd = self._max_drawdown(pnls)
        expectancy = sum(pnls) / len(trades)

        return {
            "total_trades": len(trades),
            "win_rate": round(win_rate, 2),
            "loss_rate": round(100 - win_rate, 2),
            "profit_factor": round(pf, 3),
            "expectancy": round(expectancy, 4),
            "sharpe_ratio": round(sharpe, 3),
            "sortino_ratio": round(sortino, 3),
            "max_drawdown_pct": round(max_dd, 2),
            "recovery_factor": round(sum(pnls) / max(abs(max_dd), 0.01), 3) if max_dd else 0,
            "average_trade": round(expectancy, 4),
            "average_win": round(sum(t.pnl_usd for t in wins) / len(wins), 4) if wins else 0,
            "average_loss": round(sum(t.pnl_usd for t in losses) / len(losses), 4) if losses else 0,
            "net_profit": round(sum(pnls), 4),
        }

    def by_session(self, trades: list[PaperTrade]) -> dict[str, dict]:
        buckets: dict[str, list[PaperTrade]] = defaultdict(list)
        for t in trades:
            buckets[t.session or "Unknown"].append(t)
        return {k: self.compute(v) for k, v in buckets.items()}

    def by_symbol(self, trades: list[PaperTrade]) -> dict[str, dict]:
        buckets: dict[str, list[PaperTrade]] = defaultdict(list)
        for t in trades:
            buckets[t.symbol].append(t)
        ranked = {k: self.compute(v) for k, v in buckets.items()}
        return dict(sorted(ranked.items(), key=lambda x: x[1].get("net_profit", 0), reverse=True))

    def by_strategy(self, trades: list[PaperTrade]) -> dict[str, dict]:
        buckets: dict[str, list[PaperTrade]] = defaultdict(list)
        for t in trades:
            buckets[t.strategy_name].append(t)
        return {k: self.compute(v) for k, v in buckets.items()}

    def _sharpe(self, returns: list[float]) -> float:
        if len(returns) < 2:
            return 0.0
        mean = sum(returns) / len(returns)
        var = sum((r - mean) ** 2 for r in returns) / (len(returns) - 1)
        std = math.sqrt(var) if var > 0 else 0.001
        return mean / std * math.sqrt(252)

    def _sortino(self, returns: list[float]) -> float:
        if len(returns) < 2:
            return 0.0
        mean = sum(returns) / len(returns)
        downside = [r for r in returns if r < 0]
        if not downside:
            return mean * math.sqrt(252)
        var = sum(r ** 2 for r in downside) / len(downside)
        std = math.sqrt(var) if var > 0 else 0.001
        return mean / std * math.sqrt(252)

    def _max_drawdown(self, pnls: list[float]) -> float:
        equity = 0.0
        peak = 0.0
        max_dd = 0.0
        for p in pnls:
            equity += p
            peak = max(peak, equity)
            dd = (peak - equity) / peak * 100 if peak > 0 else 0
            max_dd = max(max_dd, dd)
        return max_dd

    def _empty(self) -> dict[str, Any]:
        return {
            "total_trades": 0,
            "win_rate": 0,
            "profit_factor": 0,
            "sharpe_ratio": 0,
            "sortino_ratio": 0,
            "max_drawdown_pct": 0,
            "expectancy": 0,
            "net_profit": 0,
        }
