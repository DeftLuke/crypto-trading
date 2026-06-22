"""E5 AI Score Engine — components sum to 100, trade threshold >= 85."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class ScoreBreakdown:
    trend: float = 0.0
    liquidity_sweep: float = 0.0
    mss: float = 0.0
    displacement: float = 0.0
    fvg: float = 0.0
    order_block: float = 0.0
    volume: float = 0.0

    @property
    def total(self) -> float:
        return (
            self.trend + self.liquidity_sweep + self.mss + self.displacement
            + self.fvg + self.order_block + self.volume
        )

    def to_dict(self) -> dict[str, float]:
        return {
            "trend": self.trend,
            "liquidity_sweep": self.liquidity_sweep,
            "mss": self.mss,
            "displacement": self.displacement,
            "fvg": self.fvg,
            "order_block": self.order_block,
            "volume": self.volume,
            "total": self.total,
        }


def score_long(row: dict[str, Any], side: str = "long") -> ScoreBreakdown:
    """Score a potential long/short setup from enriched feature row."""
    s = ScoreBreakdown()
    is_long = side == "long"

    # Trend (15) — HTF 4h + 1h above/below EMA200
    htf4_bull = row.get("htf4_bullish") or row.get("4h_bullish")
    htf1_bull = row.get("htf1_bullish") or row.get("1h_bullish")
    if is_long:
        if htf4_bull and htf1_bull:
            s.trend = 15
        elif htf4_bull or htf1_bull:
            s.trend = 8
    else:
        htf4_bear = row.get("htf4_bearish")
        htf1_bear = row.get("htf1_bearish")
        if htf4_bear and htf1_bear:
            s.trend = 15
        elif htf4_bear or htf1_bear:
            s.trend = 8

    # Liquidity sweep (20)
    sweep = row.get("liquidity_sweep") or row.get("bull_sweep") or row.get("bear_sweep")
    sweep_dir = row.get("sweep_direction") or row.get("liquidity_sweep_direction")
    if sweep:
        if is_long and (sweep_dir == "bullish" or row.get("bull_sweep")):
            s.liquidity_sweep = 20
        elif not is_long and (sweep_dir == "bearish" or row.get("bear_sweep")):
            s.liquidity_sweep = 20
        else:
            s.liquidity_sweep = 10

    # MSS (20) — BOS/CHOCH after sweep
    if is_long and (row.get("bull_mss") or row.get("bos_bullish") or row.get("choch_bullish")):
        s.mss = 20
    elif not is_long and (row.get("bear_mss") or row.get("bos_bearish") or row.get("choch_bearish")):
        s.mss = 20
    elif row.get("bos") or row.get("choch"):
        s.mss = 10

    # Displacement (10) — impulse candle
    body = abs(float(row.get("close", 0)) - float(row.get("open", 0)))
    atr = float(row.get("atr14") or 0)
    if atr > 0 and body >= atr * 0.8:
        s.displacement = 10
    elif atr > 0 and body >= atr * 0.5:
        s.displacement = 5

    # FVG retest (15)
    if is_long and (row.get("fvg") or row.get("bull_fvg") or row.get("fvg_direction") == "bullish"):
        s.fvg = 15
    elif not is_long and (row.get("bear_fvg") or row.get("fvg_direction") == "bearish"):
        s.fvg = 15
    elif row.get("fvg_retest"):
        s.fvg = 10

    # Order block retest (15)
    if is_long and (row.get("order_block") or row.get("ob_retest_long")):
        s.order_block = 15
    elif not is_long and (row.get("ob_retest_short") or (
        row.get("order_block") and row.get("order_block_direction") == "bearish"
    )):
        s.order_block = 15

    # Volume (5)
    vol = float(row.get("volume") or 0)
    vol_ema = float(row.get("vol_ema20") or row.get("volume_ema20") or 0)
    if vol_ema > 0 and vol > vol_ema:
        s.volume = 5

    return s


def passes_threshold(score: ScoreBreakdown, threshold: float = 85.0) -> bool:
    return score.total >= threshold
