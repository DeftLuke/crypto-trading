"""
Fair Value Gap Engine — CP3 Module 5.

Detects 3-candle imbalances, tracks fill progress, scores 0–100.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

import polars as pl


class FVGDirection(str, Enum):
    BULLISH = "bullish"
    BEARISH = "bearish"


@dataclass
class FVGRecord:
    direction: FVGDirection
    top: float
    bottom: float
    ts: int
    bar_index: int
    gap_size: float
    fill_percentage: float = 0.0
    filled_status: bool = False
    strength_score: float = 0.0
    details: dict[str, Any] = field(default_factory=dict)

    @property
    def mid(self) -> float:
        return (self.top + self.bottom) / 2.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "direction": self.direction.value,
            "top": self.top,
            "bottom": self.bottom,
            "ts": self.ts,
            "gap_size": self.gap_size,
            "fill_percentage": self.fill_percentage,
            "filled_status": self.filled_status,
            "strength_score": self.strength_score,
            "details": self.details,
        }


@dataclass
class FVGSnapshot:
    timeframe: str
    gaps: list[FVGRecord]
    last_active: FVGRecord | None
    bar_count: int
    last_close: float

    @property
    def active_gaps(self) -> list[FVGRecord]:
        return [g for g in self.gaps if not g.filled_status]

    def best_for_direction(self, trade_direction: str | None) -> FVGRecord | None:
        active = self.active_gaps
        if not active:
            return self.gaps[-1] if self.gaps else None
        if not trade_direction:
            return max(active, key=lambda g: g.strength_score)
        want = FVGDirection.BULLISH if trade_direction.upper() in ("LONG", "BUY") else FVGDirection.BEARISH
        aligned = [g for g in active if g.direction == want]
        pool = aligned or active
        return max(pool, key=lambda g: g.strength_score)

    def to_explanation_dict(self) -> dict[str, Any]:
        best = self.best_for_direction(None)
        return {
            "status": "pass" if self.gaps else "not_detected",
            "timeframe": self.timeframe,
            "gap_count": len(self.gaps),
            "active_count": len(self.active_gaps),
            "last_active": best.to_dict() if best else None,
            "recent": [g.to_dict() for g in self.gaps[-3:]],
        }

    def fvg_score_component(self, trade_direction: str | None = None) -> float:
        """Raw points toward fvg weight (max 10)."""
        gap = self.best_for_direction(trade_direction)
        if not gap:
            return 0.0
        if gap.filled_status:
            return 0.0
        base = gap.strength_score * 0.10  # 100 → 10
        # Partially filled gaps (CE retest) score higher than untouched
        if 0 < gap.fill_percentage < 100:
            base = min(10.0, base * 1.2)
        if trade_direction:
            want = FVGDirection.BULLISH if trade_direction.upper() in ("LONG", "BUY") else FVGDirection.BEARISH
            if gap.direction != want:
                base *= 0.25
        return min(10.0, base)


class FVGEngine:
    """Detect and score fair value gaps."""

    def __init__(
        self,
        min_gap_pct: float = 0.0005,
        lookback_bars: int = 120,
    ) -> None:
        self.min_gap_pct = min_gap_pct
        self.lookback_bars = lookback_bars

    def analyze(self, df: pl.DataFrame, timeframe: str) -> FVGSnapshot:
        if df.is_empty() or len(df) < 3:
            return FVGSnapshot(timeframe=timeframe, gaps=[], last_active=None, bar_count=len(df), last_close=0.0)

        df = df.sort("ts")
        ts_list = df["ts"].to_list()
        highs = df["high"].to_list()
        lows = df["low"].to_list()
        closes = df["close"].to_list()
        n = len(df)
        start = max(2, n - self.lookback_bars)

        gaps: list[FVGRecord] = []
        for i in range(start, n):
            rec = self._detect_at(i, highs, lows, ts_list)
            if rec:
                gaps.append(rec)

        gaps = self._apply_fill_state(gaps, highs, lows, closes, n)
        active = [g for g in gaps if not g.filled_status]
        last_active = active[-1] if active else (gaps[-1] if gaps else None)

        return FVGSnapshot(
            timeframe=timeframe,
            gaps=gaps,
            last_active=last_active,
            bar_count=n,
            last_close=float(closes[-1]),
        )

    def _detect_at(
        self,
        i: int,
        highs: list[float],
        lows: list[float],
        ts_list: list[int],
    ) -> FVGRecord | None:
        ref_high = highs[i - 2]
        ref_low = lows[i - 2]

        if lows[i] > ref_high:
            bottom = ref_high
            top = lows[i]
            direction = FVGDirection.BULLISH
        elif highs[i] < ref_low:
            top = ref_low
            bottom = highs[i]
            direction = FVGDirection.BEARISH
        else:
            return None

        mid = (top + bottom) / 2.0
        gap_size = abs(top - bottom)
        if mid <= 0 or gap_size / mid < self.min_gap_pct:
            return None

        score = self._score_gap(gap_size, mid, direction)
        return FVGRecord(
            direction=direction,
            top=top,
            bottom=bottom,
            ts=ts_list[i],
            bar_index=i,
            gap_size=round(gap_size, 8),
            strength_score=score,
            details={"formation_bar": i},
        )

    def _apply_fill_state(
        self,
        gaps: list[FVGRecord],
        highs: list[float],
        lows: list[float],
        closes: list[float],
        n: int,
    ) -> list[FVGRecord]:
        updated: list[FVGRecord] = []
        for gap in gaps:
            fill_pct = 0.0
            filled = False
            for j in range(gap.bar_index + 1, n):
                if gap.direction == FVGDirection.BULLISH:
                    if lows[j] <= gap.top:
                        penetration = min(gap.top, max(gap.bottom, lows[j])) - gap.bottom
                        fill_pct = max(fill_pct, (penetration / gap.gap_size) * 100.0 if gap.gap_size else 0)
                    if lows[j] <= gap.bottom:
                        filled = True
                        fill_pct = 100.0
                        break
                else:
                    if highs[j] >= gap.bottom:
                        penetration = gap.top - max(gap.bottom, min(gap.top, highs[j]))
                        fill_pct = max(fill_pct, (penetration / gap.gap_size) * 100.0 if gap.gap_size else 0)
                    if highs[j] >= gap.top:
                        filled = True
                        fill_pct = 100.0
                        break

            score = gap.strength_score
            if 30 <= fill_pct < 100:
                score = min(100.0, score + 5.0)
            if filled:
                score = max(0.0, score - 20.0)

            updated.append(FVGRecord(
                direction=gap.direction,
                top=gap.top,
                bottom=gap.bottom,
                ts=gap.ts,
                bar_index=gap.bar_index,
                gap_size=gap.gap_size,
                fill_percentage=round(min(100.0, fill_pct), 2),
                filled_status=filled,
                strength_score=round(score, 2),
                details=gap.details,
            ))
        return updated

    def _score_gap(self, gap_size: float, mid: float, direction: FVGDirection) -> float:
        rel = (gap_size / mid) * 100.0 if mid else 0.0
        base = 55.0 + min(25.0, rel * 500.0)
        return round(min(100.0, base), 2)

    def to_rows_for_db(
        self,
        snapshot: FVGSnapshot,
        exchange: str,
        symbol: str,
        *,
        recent_limit: int = 30,
    ) -> list[dict[str, Any]]:
        sym = symbol.upper()
        return [
            {
                "exchange": exchange,
                "symbol": sym,
                "timeframe": snapshot.timeframe,
                "ts": g.ts,
                "direction": g.direction.value,
                "top": g.top,
                "bottom": g.bottom,
                "status": "filled" if g.filled_status else "active",
                "gap_size": g.gap_size,
                "fill_percentage": g.fill_percentage,
                "filled_status": g.filled_status,
                "details_json": g.details,
            }
            for g in snapshot.gaps[-recent_limit:]
        ]
