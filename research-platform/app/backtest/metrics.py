"""Comprehensive backtest metrics calculation."""

import math
from typing import Any

import numpy as np

from app.backtest.types import EquityPoint, TradeRecord


class MetricsEngine:
    def compute(self, trades: list[TradeRecord], equity: list[EquityPoint], initial_balance: float) -> dict[str, Any]:
        closed = [t for t in trades if t.exit_time and t.profit_usd is not None]
        if not closed:
            return self._empty(initial_balance)

        pnls = [t.profit_usd or 0 for t in closed]
        wins = [p for p in pnls if p > 0.01]
        losses = [p for p in pnls if p < -0.01]
        breakeven = len(pnls) - len(wins) - len(losses)

        gross_profit = sum(wins)
        gross_loss = abs(sum(losses))
        net_profit = sum(pnls)
        win_rate = len(wins) / len(closed) * 100 if closed else 0
        loss_rate = len(losses) / len(closed) * 100 if closed else 0
        profit_factor = gross_profit / gross_loss if gross_loss else float("inf")
        avg_win = sum(wins) / len(wins) if wins else 0
        avg_loss = sum(losses) / len(losses) if losses else 0
        expectancy = (win_rate / 100 * avg_win) + (loss_rate / 100 * avg_loss)

        returns = self._equity_returns(equity, initial_balance)
        sharpe = self._sharpe(returns)
        sortino = self._sortino(returns)
        max_dd, avg_dd = self._drawdowns(equity, initial_balance)
        calmar = (net_profit / initial_balance * 100) / max_dd if max_dd else 0
        recovery = net_profit / (max_dd / 100 * initial_balance) if max_dd else 0

        longs = [t for t in closed if t.direction == "LONG"]
        shorts = [t for t in closed if t.direction == "SHORT"]

        durations = [(t.exit_time - t.entry_time) / 60_000 for t in closed if t.exit_time]

        return {
            "total_signals": len(trades),
            "total_trades": len(closed),
            "winning_trades": len(wins),
            "losing_trades": len(losses),
            "breakeven_trades": breakeven,
            "win_rate": round(win_rate, 2),
            "loss_rate": round(loss_rate, 2),
            "average_win": round(avg_win, 4),
            "average_loss": round(avg_loss, 4),
            "largest_win": round(max(wins), 4) if wins else 0,
            "largest_loss": round(min(losses), 4) if losses else 0,
            "profit_factor": round(profit_factor, 4) if profit_factor != float("inf") else 999,
            "expectancy": round(expectancy, 4),
            "sharpe_ratio": round(sharpe, 4),
            "sortino_ratio": round(sortino, 4),
            "calmar_ratio": round(calmar, 4),
            "recovery_factor": round(recovery, 4),
            "net_profit": round(net_profit, 4),
            "gross_profit": round(gross_profit, 4),
            "gross_loss": round(gross_loss, 4),
            "max_drawdown_pct": round(max_dd, 4),
            "avg_drawdown_pct": round(avg_dd, 4),
            "longest_win_streak": self._streak(closed, "win"),
            "longest_loss_streak": self._streak(closed, "loss"),
            "avg_trade_duration_min": round(sum(durations) / len(durations), 2) if durations else 0,
            "long_trades": len(longs),
            "short_trades": len(shorts),
            "long_win_rate": self._win_rate(longs),
            "short_win_rate": self._win_rate(shorts),
            "long_net_profit": round(sum(t.profit_usd or 0 for t in longs), 4),
            "short_net_profit": round(sum(t.profit_usd or 0 for t in shorts), 4),
            "final_balance": round(equity[-1].balance if equity else initial_balance + net_profit, 4),
            "return_pct": round(net_profit / initial_balance * 100, 4),
        }

    def _empty(self, initial: float) -> dict[str, Any]:
        return {"total_trades": 0, "net_profit": 0, "final_balance": initial, "win_rate": 0}

    def _win_rate(self, trades: list[TradeRecord]) -> float:
        if not trades:
            return 0
        wins = sum(1 for t in trades if (t.profit_usd or 0) > 0)
        return round(wins / len(trades) * 100, 2)

    def _streak(self, trades: list[TradeRecord], kind: str) -> int:
        best = cur = 0
        for t in trades:
            is_win = (t.profit_usd or 0) > 0.01
            if (kind == "win" and is_win) or (kind == "loss" and not is_win and (t.profit_usd or 0) < -0.01):
                cur += 1
                best = max(best, cur)
            else:
                cur = 0
        return best

    def _equity_returns(self, equity: list[EquityPoint], initial: float) -> list[float]:
        if len(equity) < 2:
            return []
        vals = [initial] + [e.balance for e in equity]
        return [(vals[i] - vals[i - 1]) / vals[i - 1] for i in range(1, len(vals)) if vals[i - 1]]

    def _sharpe(self, returns: list[float], rf: float = 0) -> float:
        if len(returns) < 2:
            return 0
        arr = np.array(returns)
        std = arr.std()
        if std == 0:
            return 0
        return float((arr.mean() - rf) / std * math.sqrt(252 * 96))

    def _sortino(self, returns: list[float]) -> float:
        if len(returns) < 2:
            return 0
        arr = np.array(returns)
        downside = arr[arr < 0]
        if len(downside) == 0:
            return float("inf")
        dd_std = downside.std()
        if dd_std == 0:
            return 0
        return float(arr.mean() / dd_std * math.sqrt(252 * 96))

    def _drawdowns(self, equity: list[EquityPoint], initial: float) -> tuple[float, float]:
        if not equity:
            return 0, 0
        peak = initial
        max_dd = 0
        dds = []
        for e in equity:
            peak = max(peak, e.balance)
            dd = (peak - e.balance) / peak * 100 if peak else 0
            max_dd = max(max_dd, dd)
            dds.append(dd)
        return max_dd, sum(dds) / len(dds) if dds else 0
