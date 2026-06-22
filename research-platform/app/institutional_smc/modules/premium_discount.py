"""
Premium / Discount Engine — CP4 Module 6.

Maps price within the active dealing range (swing high → swing low).
LONG prefers discount; SHORT prefers premium.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

import polars as pl

from app.smc.swings import find_swings


class PriceZone(str, Enum):
    PREMIUM = "premium"
    DISCOUNT = "discount"
    EQUILIBRIUM = "equilibrium"


@dataclass
class PremiumDiscountSnapshot:
    timeframe: str
    range_high: float
    range_low: float
    equilibrium: float
    current_price: float
    position_pct: float
    zone: PriceZone
    strength_score: float
    bar_count: int
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "timeframe": self.timeframe,
            "range_high": self.range_high,
            "range_low": self.range_low,
            "equilibrium": self.equilibrium,
            "current_price": self.current_price,
            "position_pct": self.position_pct,
            "zone": self.zone.value,
            "strength_score": self.strength_score,
            "details": self.details,
        }

    def to_explanation_dict(self) -> dict[str, Any]:
        return {
            "status": "pass",
            "timeframe": self.timeframe,
            **self.to_dict(),
        }

    def pd_score_component(self, trade_direction: str | None = None) -> float:
        """Raw points toward premium_discount weight (max 8)."""
        if not trade_direction or trade_direction.upper() == "IGNORE":
            return min(8.0, self.strength_score * 0.08)

        is_long = trade_direction.upper() in ("LONG", "BUY")
        aligned = (is_long and self.zone == PriceZone.DISCOUNT) or (
            not is_long and self.zone == PriceZone.PREMIUM
        )
        neutral = self.zone == PriceZone.EQUILIBRIUM

        base = self.strength_score * 0.08  # 100 → 8
        if aligned:
            depth_bonus = 0.0
            if is_long and self.zone == PriceZone.DISCOUNT:
                depth_bonus = max(0.0, (50.0 - self.position_pct) / 50.0) * 2.0
            elif not is_long and self.zone == PriceZone.PREMIUM:
                depth_bonus = max(0.0, (self.position_pct - 50.0) / 50.0) * 2.0
            base = min(8.0, base + depth_bonus)
        elif neutral:
            base *= 0.35
        else:
            base *= 0.15  # wrong zone — premium/discount violation penalty
        return min(8.0, base)


class PremiumDiscountEngine:
    """Classify price location within institutional dealing range."""

    def __init__(
        self,
        swing_lookback: int = 3,
        range_lookback_bars: int = 120,
        eq_tolerance_pct: float = 2.0,
    ) -> None:
        self.swing_lookback = swing_lookback
        self.range_lookback_bars = range_lookback_bars
        self.eq_tolerance_pct = eq_tolerance_pct

    def analyze(self, df: pl.DataFrame, timeframe: str) -> PremiumDiscountSnapshot:
        if df.is_empty():
            return self._empty(timeframe)

        df = df.sort("ts")
        highs = df["high"].to_list()
        lows = df["low"].to_list()
        closes = df["close"].to_list()
        ts_list = df["ts"].to_list()
        n = len(df)
        current = float(closes[-1])

        start = max(0, n - self.range_lookback_bars)
        sub_highs = highs[start:]
        sub_lows = lows[start:]
        sub_ts = ts_list[start:]

        swing_highs, swing_lows = find_swings(sub_highs, sub_lows, sub_ts, self.swing_lookback)
        if not swing_highs or not swing_lows:
            range_high = max(sub_highs)
            range_low = min(sub_lows)
        else:
            range_high = swing_highs[-1].price
            range_low = swing_lows[-1].price
            if range_high <= range_low:
                range_high = max(sub_highs)
                range_low = min(sub_lows)

        span = max(range_high - range_low, 1e-12)
        equilibrium = (range_high + range_low) / 2.0
        position_pct = ((current - range_low) / span) * 100.0
        zone = self._classify_zone(position_pct)

        strength = self._score_zone(zone, position_pct)
        return PremiumDiscountSnapshot(
            timeframe=timeframe,
            range_high=range_high,
            range_low=range_low,
            equilibrium=equilibrium,
            current_price=current,
            position_pct=round(position_pct, 2),
            zone=zone,
            strength_score=strength,
            bar_count=n,
            details={
                "swing_high_ts": swing_highs[-1].ts if swing_highs else None,
                "swing_low_ts": swing_lows[-1].ts if swing_lows else None,
            },
        )

    def _classify_zone(self, position_pct: float) -> PriceZone:
        if abs(position_pct - 50.0) <= self.eq_tolerance_pct:
            return PriceZone.EQUILIBRIUM
        if position_pct > 50.0:
            return PriceZone.PREMIUM
        return PriceZone.DISCOUNT

    def _score_zone(self, zone: PriceZone, position_pct: float) -> float:
        if zone == PriceZone.EQUILIBRIUM:
            return 45.0
        if zone == PriceZone.DISCOUNT:
            return min(100.0, 55.0 + (50.0 - position_pct) * 0.9)
        return min(100.0, 55.0 + (position_pct - 50.0) * 0.9)

    def _empty(self, timeframe: str) -> PremiumDiscountSnapshot:
        return PremiumDiscountSnapshot(
            timeframe=timeframe,
            range_high=0.0,
            range_low=0.0,
            equilibrium=0.0,
            current_price=0.0,
            position_pct=50.0,
            zone=PriceZone.EQUILIBRIUM,
            strength_score=0.0,
            bar_count=0,
            details={"reason": "no_data"},
        )
