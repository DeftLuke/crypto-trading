"""SMC, session, symbol, drawdown analytics."""

from typing import Any

from app.backtest.types import TradeRecord


class AnalyticsEngine:
    def session_stats(self, trades: list[TradeRecord]) -> list[dict[str, Any]]:
        return self._group_stats(trades, lambda t: t.session or "unknown")

    def symbol_stats(self, trades: list[TradeRecord]) -> list[dict[str, Any]]:
        return self._group_stats(trades, lambda t: t.symbol)

    def smc_stats(self, trades: list[TradeRecord]) -> list[dict[str, Any]]:
        features = []
        for t in trades:
            if t.bos:
                features.append(("BOS", t))
            if t.choch:
                features.append(("CHOCH", t))
            if t.order_block:
                features.append(("Order Block", t))
            if t.fvg:
                features.append(("FVG", t))
            if t.liquidity_sweep:
                features.append(("Liquidity Sweep", t))
        buckets: dict[str, list[TradeRecord]] = {}
        for name, trade in features:
            buckets.setdefault(name, []).append(trade)
        return [self._stats_row(name, group) for name, group in sorted(buckets.items())]

    def direction_stats(self, trades: list[TradeRecord]) -> dict[str, Any]:
        longs = [t for t in trades if t.direction == "LONG" and t.profit_usd is not None]
        shorts = [t for t in trades if t.direction == "SHORT" and t.profit_usd is not None]
        return {
            "long": self._stats_row("LONG", longs),
            "short": self._stats_row("SHORT", shorts),
        }

    def drawdown_report(self, max_dd: float, avg_dd: float, net_profit: float, initial: float) -> dict[str, Any]:
        return {
            "max_drawdown_pct": max_dd,
            "avg_drawdown_pct": avg_dd,
            "max_drawdown_usd": max_dd / 100 * initial,
            "recovery_factor": net_profit / (max_dd / 100 * initial) if max_dd else 0,
        }

    def _group_stats(self, trades: list[TradeRecord], key_fn) -> list[dict[str, Any]]:
        closed = [t for t in trades if t.profit_usd is not None]
        buckets: dict[str, list[TradeRecord]] = {}
        for t in closed:
            buckets.setdefault(key_fn(t), []).append(t)
        return [self._stats_row(k, v) for k, v in sorted(buckets.items())]

    def _stats_row(self, name: str, group: list[TradeRecord]) -> dict[str, Any]:
        if not group:
            return {"name": name, "trades": 0, "win_rate": 0, "profit_factor": 0, "net_profit": 0}
        wins = [t for t in group if (t.profit_usd or 0) > 0]
        losses = [t for t in group if (t.profit_usd or 0) < 0]
        gp = sum(t.profit_usd or 0 for t in wins)
        gl = abs(sum(t.profit_usd or 0 for t in losses))
        return {
            "name": name,
            "trades": len(group),
            "wins": len(wins),
            "win_rate": round(len(wins) / len(group) * 100, 2),
            "profit_factor": round(gp / gl, 4) if gl else 999,
            "net_profit": round(sum(t.profit_usd or 0 for t in group), 4),
        }
