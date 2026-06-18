"""Reflection engine — generate post-trade reflections."""

from __future__ import annotations

from typing import Any

from app.memory.types import ReflectionMemory, build_search_text, utc_now_iso


class ReflectionEngine:
    def generate_trade_reflection(self, trade: dict[str, Any]) -> ReflectionMemory:
        reasons: list[str] = []
        smc = trade.get("smc_features") or trade.get("smc") or {}
        indicators = trade.get("indicators") or {}

        if smc.get("bos") or smc.get("bearish_bos") or smc.get("bullish_bos"):
            reasons.append("BOS aligned with trade direction")
        if smc.get("ob") or smc.get("order_block"):
            reasons.append("Order block retest confirmed entry")
        if smc.get("liquidity_sweep"):
            reasons.append("Liquidity sweep preceded move")
        if smc.get("choch"):
            reasons.append("CHoCH confirmed structure shift")

        rsi = indicators.get("rsi") or trade.get("rsi")
        if rsi is not None:
            if float(rsi) > 70 and trade.get("direction", "").upper() == "SHORT":
                reasons.append(f"RSI overbought ({rsi}) supported short")
            elif float(rsi) < 30 and trade.get("direction", "").upper() == "LONG":
                reasons.append(f"RSI oversold ({rsi}) supported long")

        session = trade.get("session")
        if session:
            reasons.append(f"{session} session context")

        result = (trade.get("result") or "").upper()
        if result == "WIN":
            headline = "Trade succeeded because:"
        elif result == "LOSS":
            headline = "Trade failed despite:"
        else:
            headline = "Trade setup analysis:"

        if not reasons:
            reasons.append("Confluence score and strategy rules matched entry criteria")

        observation = f"{headline} " + "; ".join(reasons) + "."
        evidence = build_search_text(trade)

        conf = 0.55
        if trade.get("confluence_score"):
            conf = min(0.95, float(trade["confluence_score"]) / 100 if float(trade["confluence_score"]) > 1 else float(trade["confluence_score"]))
        if result == "WIN":
            conf = min(0.95, conf + 0.1)

        ref = ReflectionMemory(
            observation=observation,
            evidence=evidence[:2000],
            confidence=conf,
            category="trade_outcome",
            related_symbols=[trade["symbol"]] if trade.get("symbol") else [],
            text=f"{observation} {evidence[:500]}",
        )
        ref.updated_at = utc_now_iso()
        return ref

    def generate_pattern_reflection(
        self,
        pattern_name: str,
        win_rate: float,
        trade_count: int,
        conditions: list[str],
    ) -> ReflectionMemory:
        obs = (
            f"{pattern_name}: {' + '.join(conditions)} produced {win_rate:.0f}% win rate "
            f"across {trade_count} trades."
        )
        return ReflectionMemory(
            observation=obs,
            evidence=f"pattern={pattern_name}; conditions={conditions}; n={trade_count}",
            confidence=min(0.95, 0.5 + trade_count * 0.005),
            category="pattern",
            text=obs,
        )
