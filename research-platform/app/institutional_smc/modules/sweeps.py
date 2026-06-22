"""
Liquidity Sweep Engine — CP2 Module 3.

Detects wick-through + close-back-inside sweeps; classifies weak/strong; scores 0–100.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

import polars as pl

from app.institutional_smc.modules.liquidity import LiquidityLevelRecord, LiquiditySnapshot


class SweepType(str, Enum):
    WEAK = "weak"
    STRONG = "strong"


class SweepDirection(str, Enum):
    BUYSIDE = "buyside"   # swept lows → bullish implication
    SELLSIDE = "sellside"  # swept highs → bearish implication


@dataclass
class SweepRecord:
    sweep_type: SweepType
    sweep_direction: SweepDirection
    sweep_time: int
    bar_index: int
    liquidity_source: str
    level_price: float
    score: float
    wick_penetration_pct: float
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "sweep_type": self.sweep_type.value,
            "sweep_direction": self.sweep_direction.value,
            "sweep_time": self.sweep_time,
            "liquidity_source": self.liquidity_source,
            "level_price": self.level_price,
            "score": self.score,
            "wick_penetration_pct": self.wick_penetration_pct,
            "details": self.details,
        }


@dataclass
class SweepSnapshot:
    timeframe: str
    sweeps: list[SweepRecord]
    last_sweep: SweepRecord | None

    def to_explanation_dict(self) -> dict[str, Any]:
        return {
            "status": "pass" if self.sweeps else "not_detected",
            "timeframe": self.timeframe,
            "sweep_count": len(self.sweeps),
            "last_sweep": self.last_sweep.to_dict() if self.last_sweep else None,
            "recent": [s.to_dict() for s in self.sweeps[-3:]],
        }

    def sweep_score_component(self, trade_direction: str | None = None) -> float:
        """Raw points toward liquidity_sweep weight (max 20)."""
        if not self.last_sweep:
            return 0.0
        base = self.last_sweep.score * 0.2  # score 0-100 → up to 20 raw
        if trade_direction:
            want_bull = trade_direction.upper() in ("LONG", "BUY")
            aligned = (
                (want_bull and self.last_sweep.sweep_direction == SweepDirection.BUYSIDE)
                or (not want_bull and self.last_sweep.sweep_direction == SweepDirection.SELLSIDE)
            )
            if not aligned:
                base *= 0.25
            elif self.last_sweep.sweep_type == SweepType.STRONG:
                base = min(20.0, base * 1.1)
        return min(20.0, base)


class SweepEngine:
    """Detect liquidity sweeps against active liquidity levels."""

    def __init__(
        self,
        weak_penetration_pct: float = 0.0008,
        strong_penetration_pct: float = 0.0015,
        lookback_bars: int = 30,
    ) -> None:
        self.weak_penetration_pct = weak_penetration_pct
        self.strong_penetration_pct = strong_penetration_pct
        self.lookback_bars = lookback_bars

    def analyze(
        self,
        df: pl.DataFrame,
        liquidity: LiquiditySnapshot,
        timeframe: str,
    ) -> SweepSnapshot:
        if df.is_empty() or not liquidity.levels:
            return SweepSnapshot(timeframe=timeframe, sweeps=[], last_sweep=None)

        df = df.sort("ts")
        ts_list = df["ts"].to_list()
        opens = df["open"].to_list()
        highs = df["high"].to_list()
        lows = df["low"].to_list()
        closes = df["close"].to_list()
        volumes = df["volume"].to_list() if "volume" in df.columns else [0.0] * len(df)

        avg_vol = sum(volumes[-20:]) / max(len(volumes[-20:]), 1)
        sweeps: list[SweepRecord] = []
        start = max(0, len(df) - self.lookback_bars)

        for i in range(start, len(df)):
            for lv in liquidity.levels:
                rec = self._detect_at_bar(
                    i, lv, ts_list[i], opens[i], highs[i], lows[i], closes[i],
                    volumes[i], avg_vol,
                )
                if rec:
                    sweeps.append(rec)

        last = sweeps[-1] if sweeps else None
        return SweepSnapshot(timeframe=timeframe, sweeps=sweeps, last_sweep=last)

    def _detect_at_bar(
        self,
        index: int,
        level: LiquidityLevelRecord,
        ts: int,
        open_p: float,
        high: float,
        low: float,
        close: float,
        volume: float,
        avg_vol: float,
    ) -> SweepRecord | None:
        ltype = level.liquidity_type.value
        is_high_pool = "high" in ltype
        is_low_pool = "low" in ltype

        if is_high_pool:
            if not (high > level.price and close < level.price):
                return None
            penetration = (high - level.price) / level.price
            direction = SweepDirection.SELLSIDE
        elif is_low_pool:
            if not (low < level.price and close > level.price):
                return None
            penetration = (level.price - low) / level.price
            direction = SweepDirection.BUYSIDE
        else:
            return None

        body = abs(close - open_p)
        rng = max(high - low, 1e-12)
        rejection_ratio = (rng - body) / rng
        vol_spike = volume > avg_vol * 1.3 if avg_vol > 0 else False

        if penetration >= self.strong_penetration_pct or rejection_ratio >= 0.55 or vol_spike:
            sweep_type = SweepType.STRONG
        elif penetration >= self.weak_penetration_pct:
            sweep_type = SweepType.WEAK
        else:
            return None

        score = self._score_sweep(penetration, rejection_ratio, vol_spike, level.strength_score, sweep_type)

        return SweepRecord(
            sweep_type=sweep_type,
            sweep_direction=direction,
            sweep_time=ts,
            bar_index=index,
            liquidity_source=level.liquidity_type.value,
            level_price=level.price,
            score=score,
            wick_penetration_pct=round(penetration * 100, 4),
            details={
                "rejection_ratio": round(rejection_ratio, 3),
                "volume_spike": vol_spike,
                "level_strength": level.strength_score,
            },
        )

    def _score_sweep(
        self,
        penetration: float,
        rejection_ratio: float,
        vol_spike: bool,
        level_strength: float,
        sweep_type: SweepType,
    ) -> float:
        base = 45.0 if sweep_type == SweepType.WEAK else 65.0
        base += min(20.0, penetration * 10_000)
        base += rejection_ratio * 15.0
        if vol_spike:
            base += 8.0
        base += min(10.0, level_strength * 0.15)
        return round(min(100.0, base), 2)

    def to_rows_for_db(
        self,
        snapshot: SweepSnapshot,
        exchange: str,
        symbol: str,
        *,
        recent_limit: int = 20,
    ) -> list[dict[str, Any]]:
        sym = symbol.upper()
        return [
            {
                "exchange": exchange,
                "symbol": sym,
                "timeframe": snapshot.timeframe,
                "ts": s.sweep_time,
                "sweep_direction": s.sweep_direction.value,
                "swept_price": s.level_price,
                "sweep_type": s.sweep_type.value,
                "liquidity_source": s.liquidity_source,
                "score": s.score,
                "details_json": s.details,
            }
            for s in snapshot.sweeps[-recent_limit:]
        ]
