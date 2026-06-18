"""Pattern discovery — identify recurring profitable setups."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from app.memory.types import PatternMemory, utc_now_iso


class PatternDiscovery:
    MIN_TRADES = 5

    def discover_from_trades(self, trades: list[dict[str, Any]]) -> list[PatternMemory]:
        buckets: dict[str, list[dict[str, Any]]] = defaultdict(list)

        for t in trades:
            key = self._pattern_key(t)
            buckets[key].append(t)

        patterns: list[PatternMemory] = []
        for key, group in buckets.items():
            if len(group) < self.MIN_TRADES:
                continue
            wins = [g for g in group if (g.get("result") or "").upper() == "WIN" or (g.get("profit_percent") or 0) > 0]
            profits = [float(g.get("profit_percent") or 0) for g in group]
            win_rate = len(wins) / len(group) * 100
            gross_win = sum(p for p in profits if p > 0) or 0.01
            gross_loss = abs(sum(p for p in profits if p < 0)) or 0.01
            pf = gross_win / gross_loss

            conditions = key.split("|")
            session = next((c.replace("session:", "") for c in conditions if c.startswith("session:")), None)
            name = " + ".join(c for c in conditions if not c.startswith("session:"))

            pat = PatternMemory(
                pattern_name=name or key,
                conditions=conditions,
                win_rate=round(win_rate, 2),
                profit_factor=round(pf, 3),
                trade_count=len(group),
                avg_profit=round(sum(profits) / len(profits), 3),
                session=session,
                text=f"Pattern {name}: WR {win_rate:.0f}% over {len(group)} trades",
            )
            pat.updated_at = utc_now_iso()
            patterns.append(pat)

        patterns.sort(key=lambda p: (p.win_rate or 0) * (p.trade_count or 0), reverse=True)
        return patterns

    def _pattern_key(self, trade: dict[str, Any]) -> str:
        parts: list[str] = []
        smc = trade.get("smc_features") or trade.get("smc") or {}
        indicators = trade.get("indicators") or {}

        if smc.get("bos"):
            parts.append("BOS")
        if smc.get("ob") or smc.get("order_block"):
            parts.append("Order Block")
        if smc.get("liquidity_sweep"):
            parts.append("Liquidity Sweep")
        if smc.get("choch"):
            parts.append("CHOCH")

        rsi = indicators.get("rsi") or trade.get("rsi")
        if rsi is not None:
            if float(rsi) > 80:
                parts.append("RSI > 80")
            elif float(rsi) > 70:
                parts.append("RSI > 70")
            elif float(rsi) < 20:
                parts.append("RSI < 20")

        direction = trade.get("direction", "").upper()
        if direction:
            parts.append(f"{direction}")

        session = trade.get("session")
        if session:
            parts.append(f"session:{session}")

        if not parts:
            parts.append(trade.get("strategy_name") or "generic")

        return "|".join(parts)
