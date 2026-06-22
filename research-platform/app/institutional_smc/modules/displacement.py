"""
Displacement Engine — CP4 Module 7.

Detects institutional impulse candles: body expansion vs ATR, volume spike.
OI expansion flagged when data unavailable.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

import polars as pl


class DisplacementDirection(str, Enum):
    BULLISH = "bullish"
    BEARISH = "bearish"


@dataclass
class DisplacementRecord:
    direction: DisplacementDirection
    ts: int
    bar_index: int
    strength_score: float
    atr_expansion: bool = False
    volume_expansion: bool = False
    oi_expansion: bool = False
    body_pct: float = 0.0
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "direction": self.direction.value,
            "ts": self.ts,
            "strength_score": self.strength_score,
            "atr_expansion": self.atr_expansion,
            "volume_expansion": self.volume_expansion,
            "oi_expansion": self.oi_expansion,
            "body_pct": self.body_pct,
            "details": self.details,
        }


@dataclass
class DisplacementSnapshot:
    timeframe: str
    displacements: list[DisplacementRecord]
    last_displacement: DisplacementRecord | None
    bar_count: int
    last_close: float

    def to_explanation_dict(self) -> dict[str, Any]:
        return {
            "status": "pass" if self.displacements else "not_detected",
            "timeframe": self.timeframe,
            "displacement_count": len(self.displacements),
            "last_displacement": self.last_displacement.to_dict() if self.last_displacement else None,
            "recent": [d.to_dict() for d in self.displacements[-3:]],
        }

    def displacement_score_component(self, trade_direction: str | None = None) -> float:
        """Raw points toward displacement weight (max 10)."""
        if not self.last_displacement:
            return 0.0
        base = self.last_displacement.strength_score * 0.10  # 100 → 10
        if trade_direction and trade_direction.upper() != "IGNORE":
            is_long = trade_direction.upper() in ("LONG", "BUY")
            want = DisplacementDirection.BULLISH if is_long else DisplacementDirection.BEARISH
            if self.last_displacement.direction != want:
                base *= 0.25
            elif self.last_displacement.atr_expansion and self.last_displacement.volume_expansion:
                base = min(10.0, base * 1.1)
        return min(10.0, base)


class DisplacementEngine:
    """Detect displacement / impulse candles on OHLCV data."""

    def __init__(
        self,
        atr_period: int = 14,
        body_ratio_min: float = 0.55,
        atr_body_mult: float = 1.1,
        atr_range_mult: float = 1.2,
        volume_mult: float = 1.3,
        lookback_bars: int = 40,
    ) -> None:
        self.atr_period = atr_period
        self.body_ratio_min = body_ratio_min
        self.atr_body_mult = atr_body_mult
        self.atr_range_mult = atr_range_mult
        self.volume_mult = volume_mult
        self.lookback_bars = lookback_bars

    def analyze(self, df: pl.DataFrame, timeframe: str) -> DisplacementSnapshot:
        if df.is_empty() or len(df) < self.atr_period + 2:
            return DisplacementSnapshot(
                timeframe=timeframe, displacements=[], last_displacement=None,
                bar_count=len(df), last_close=0.0,
            )

        df = df.sort("ts")
        ts_list = df["ts"].to_list()
        opens = df["open"].to_list()
        highs = df["high"].to_list()
        lows = df["low"].to_list()
        closes = df["close"].to_list()
        volumes = df["volume"].to_list() if "volume" in df.columns else [0.0] * len(df)
        atrs = self._compute_atr(highs, lows, closes)
        n = len(df)
        start = max(self.atr_period, n - self.lookback_bars)

        displacements: list[DisplacementRecord] = []
        for i in range(start, n):
            atr = atrs[i]
            if atr <= 0:
                continue
            body = abs(closes[i] - opens[i])
            rng = max(highs[i] - lows[i], 1e-12)
            body_pct = body / rng
            if body_pct < self.body_ratio_min:
                continue
            if body < atr * self.atr_body_mult:
                continue

            vol_avg = sum(volumes[max(0, i - 20):i]) / max(min(i, 20), 1)
            volume_expansion = volumes[i] > vol_avg * self.volume_mult if vol_avg > 0 else False
            atr_expansion = rng >= atr * self.atr_range_mult
            direction = DisplacementDirection.BULLISH if closes[i] > opens[i] else DisplacementDirection.BEARISH

            score = self._score(body_pct, body / atr, volume_expansion, atr_expansion)
            displacements.append(DisplacementRecord(
                direction=direction,
                ts=ts_list[i],
                bar_index=i,
                strength_score=score,
                atr_expansion=atr_expansion,
                volume_expansion=volume_expansion,
                oi_expansion=False,
                body_pct=round(body_pct, 4),
                details={
                    "body_atr_ratio": round(body / atr, 3),
                    "range_atr_ratio": round(rng / atr, 3),
                    "oi_data_available": False,
                },
            ))

        last = displacements[-1] if displacements else None
        return DisplacementSnapshot(
            timeframe=timeframe,
            displacements=displacements,
            last_displacement=last,
            bar_count=n,
            last_close=float(closes[-1]),
        )

    def _compute_atr(self, highs: list[float], lows: list[float], closes: list[float]) -> list[float]:
        n = len(highs)
        trs: list[float] = [highs[0] - lows[0]]
        for i in range(1, n):
            tr = max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i - 1]),
                abs(lows[i] - closes[i - 1]),
            )
            trs.append(tr)
        atrs: list[float] = [0.0] * n
        period = self.atr_period
        if n < period:
            return atrs
        seed = sum(trs[:period]) / period
        atrs[period - 1] = seed
        alpha = 1.0 / period
        prev = seed
        for i in range(period, n):
            prev = prev + alpha * (trs[i] - prev)
            atrs[i] = prev
        return atrs

    def _score(
        self,
        body_pct: float,
        body_atr_ratio: float,
        volume_expansion: bool,
        atr_expansion: bool,
    ) -> float:
        base = 50.0 + body_pct * 25.0 + min(20.0, (body_atr_ratio - 1.0) * 15.0)
        if volume_expansion:
            base += 10.0
        if atr_expansion:
            base += 10.0
        return round(min(100.0, max(0.0, base)), 2)

    def to_rows_for_db(
        self,
        snapshot: DisplacementSnapshot,
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
                "ts": d.ts,
                "direction": d.direction.value,
                "strength_score": d.strength_score,
                "atr_expansion": d.atr_expansion,
                "volume_expansion": d.volume_expansion,
                "oi_expansion": d.oi_expansion,
                "body_pct": d.body_pct,
                "details_json": d.details,
            }
            for d in snapshot.displacements[-recent_limit:]
        ]
