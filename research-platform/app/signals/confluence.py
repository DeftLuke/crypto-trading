"""Confluence scoring — max 100 points."""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ConfluenceWeights:
    ema_alignment: float = 15
    rsi_condition: float = 10
    bos_alignment: float = 20
    choch_alignment: float = 15
    liquidity_sweep: float = 15
    order_block_retest: float = 15
    fvg_alignment: float = 10

    @property
    def max_score(self) -> float:
        return (
            self.ema_alignment + self.rsi_condition + self.bos_alignment
            + self.choch_alignment + self.liquidity_sweep + self.order_block_retest
            + self.fvg_alignment
        )


@dataclass
class ConfluenceResult:
    score: float
    breakdown: dict[str, float] = field(default_factory=dict)
    direction: str = "NEUTRAL"

    def to_dict(self) -> dict[str, Any]:
        return {
            "confluence_score": round(self.score, 1),
            "direction": self.direction,
            "breakdown": self.breakdown,
        }


class ConfluenceEngine:
    def __init__(self, weights: ConfluenceWeights | None = None) -> None:
        self.weights = weights or ConfluenceWeights()

    def score(
        self,
        indicators: dict[str, Any],
        smc: dict[str, Any],
        direction: str = "SHORT",
    ) -> ConfluenceResult:
        bd: dict[str, float] = {}
        is_short = direction.upper() == "SHORT"

        close = indicators.get("15m_close") or indicators.get("close")
        ema100 = indicators.get("1h_ema100") or indicators.get("ema100")
        rsi = indicators.get("15m_rsi14") or indicators.get("rsi14") or indicators.get("rsi")

        if close and ema100:
            aligned = (is_short and close < ema100) or (not is_short and close > ema100)
            bd["ema_alignment"] = self.weights.ema_alignment if aligned else 0

        if rsi is not None:
            rsi_ok = (is_short and rsi > 70) or (not is_short and rsi < 30)
            bd["rsi_condition"] = self.weights.rsi_condition if rsi_ok else self.weights.rsi_condition * 0.3

        bos_type = smc.get("bos_type")
        if bos_type:
            aligned = (is_short and bos_type == "bearish") or (not is_short and bos_type == "bullish")
            bd["bos_alignment"] = self.weights.bos_alignment if aligned else 0

        choch_type = smc.get("choch_type")
        if choch_type:
            aligned = (is_short and choch_type == "bearish") or (not is_short and choch_type == "bullish")
            bd["choch_alignment"] = self.weights.choch_alignment if aligned else 0

        if smc.get("liquidity_sweep"):
            sweep = smc.get("sweep_direction")
            aligned = (is_short and sweep == "sellside") or (not is_short and sweep == "buyside")
            bd["liquidity_sweep"] = self.weights.liquidity_sweep if aligned else 0

        if smc.get("order_block"):
            ob_dir = smc.get("order_block_direction") or smc.get("ob_direction")
            aligned = (is_short and ob_dir == "bearish") or (not is_short and ob_dir == "bullish")
            bd["order_block_retest"] = self.weights.order_block_retest if aligned else 0

        if smc.get("fvg"):
            fvg_dir = smc.get("fvg_direction")
            aligned = (is_short and fvg_dir == "bearish") or (not is_short and fvg_dir == "bullish")
            bd["fvg_alignment"] = self.weights.fvg_alignment if aligned else 0

        total = sum(bd.values())
        max_w = self.weights.max_score
        normalized = min(100, total / max_w * 100) if max_w else 0
        return ConfluenceResult(score=normalized, breakdown=bd, direction=direction)
