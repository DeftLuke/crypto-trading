"""
Order Block Engine — CP3 Module 4.

Detects institutional OB zones (last opposing candle before impulse),
tracks mitigation/retest, and scores 0–100.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

import polars as pl

from app.institutional_smc.modules.structure import MarketStructureSnapshot


class OrderBlockDirection(str, Enum):
    BULLISH = "bullish"
    BEARISH = "bearish"


@dataclass
class OrderBlockRecord:
    direction: OrderBlockDirection
    high: float
    low: float
    ts: int
    bar_index: int
    strength_score: float
    mitigated: bool = False
    has_displacement: bool = False
    has_bos_after: bool = False
    volume_confirmed: bool = False
    retest_confirmed: bool = False
    details: dict[str, Any] = field(default_factory=dict)

    @property
    def mid(self) -> float:
        return (self.high + self.low) / 2.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "direction": self.direction.value,
            "high": self.high,
            "low": self.low,
            "ts": self.ts,
            "strength_score": self.strength_score,
            "mitigated": self.mitigated,
            "has_displacement": self.has_displacement,
            "has_bos_after": self.has_bos_after,
            "volume_confirmed": self.volume_confirmed,
            "retest_confirmed": self.retest_confirmed,
            "details": self.details,
        }


@dataclass
class OrderBlockSnapshot:
    timeframe: str
    blocks: list[OrderBlockRecord]
    last_active: OrderBlockRecord | None
    bar_count: int
    last_close: float

    @property
    def active_blocks(self) -> list[OrderBlockRecord]:
        return [b for b in self.blocks if not b.mitigated]

    def best_for_direction(self, trade_direction: str | None) -> OrderBlockRecord | None:
        active = self.active_blocks
        if not active:
            return self.blocks[-1] if self.blocks else None
        if not trade_direction:
            return max(active, key=lambda b: b.strength_score)
        want = OrderBlockDirection.BULLISH if trade_direction.upper() in ("LONG", "BUY") else OrderBlockDirection.BEARISH
        aligned = [b for b in active if b.direction == want]
        pool = aligned or active
        return max(pool, key=lambda b: b.strength_score)

    def to_explanation_dict(self) -> dict[str, Any]:
        best = self.best_for_direction(None)
        return {
            "status": "pass" if self.blocks else "not_detected",
            "timeframe": self.timeframe,
            "block_count": len(self.blocks),
            "active_count": len(self.active_blocks),
            "last_active": best.to_dict() if best else None,
            "recent": [b.to_dict() for b in self.blocks[-3:]],
        }

    def ob_score_component(self, trade_direction: str | None = None) -> float:
        """Raw points toward order_block weight (max 12)."""
        ob = self.best_for_direction(trade_direction)
        if not ob:
            return 0.0
        base = ob.strength_score * 0.12  # 100 → 12
        if ob.mitigated and ob.retest_confirmed:
            base = min(12.0, base * 1.15)
        if trade_direction:
            want = OrderBlockDirection.BULLISH if trade_direction.upper() in ("LONG", "BUY") else OrderBlockDirection.BEARISH
            if ob.direction != want:
                base *= 0.25
        return min(12.0, base)


class OrderBlockEngine:
    """Detect and score institutional order blocks."""

    def __init__(
        self,
        min_impulse_pct: float = 0.003,
        displacement_body_ratio: float = 0.55,
        lookback_bars: int = 120,
    ) -> None:
        self.min_impulse_pct = min_impulse_pct
        self.displacement_body_ratio = displacement_body_ratio
        self.lookback_bars = lookback_bars

    def analyze(
        self,
        df: pl.DataFrame,
        timeframe: str,
        *,
        structure: MarketStructureSnapshot | None = None,
    ) -> OrderBlockSnapshot:
        if df.is_empty():
            return OrderBlockSnapshot(timeframe=timeframe, blocks=[], last_active=None, bar_count=0, last_close=0.0)

        df = df.sort("ts")
        ts_list = df["ts"].to_list()
        opens = df["open"].to_list()
        highs = df["high"].to_list()
        lows = df["low"].to_list()
        closes = df["close"].to_list()
        volumes = df["volume"].to_list() if "volume" in df.columns else [0.0] * len(df)
        n = len(df)
        start = max(2, n - self.lookback_bars)

        blocks: list[OrderBlockRecord] = []
        for i in range(start, n):
            move_pct = abs(closes[i] - closes[i - 1]) / closes[i - 1] if closes[i - 1] else 0.0
            if move_pct < self.min_impulse_pct:
                continue

            ob_bar = i - 1
            body = abs(closes[i] - opens[i])
            rng = max(highs[i] - lows[i], 1e-12)
            has_displacement = body / rng >= self.displacement_body_ratio
            vol_avg = sum(volumes[max(0, i - 20):i]) / max(min(i, 20), 1)
            volume_confirmed = volumes[i] > vol_avg * 1.2 if vol_avg > 0 else False

            if closes[i] > closes[i - 1] and closes[ob_bar] < opens[ob_bar]:
                direction = OrderBlockDirection.BULLISH
            elif closes[i] < closes[i - 1] and closes[ob_bar] > opens[ob_bar]:
                direction = OrderBlockDirection.BEARISH
            else:
                continue

            ob = OrderBlockRecord(
                direction=direction,
                high=highs[ob_bar],
                low=lows[ob_bar],
                ts=ts_list[ob_bar],
                bar_index=ob_bar,
                strength_score=0.0,
                has_displacement=has_displacement,
                volume_confirmed=volume_confirmed,
                details={"impulse_pct": round(move_pct * 100, 4), "impulse_bar": i},
            )
            ob.strength_score = self._score_ob(ob)
            blocks.append(ob)

        blocks = self._apply_lifecycle(blocks, opens, highs, lows, closes, ts_list, start, n)
        if structure:
            blocks = self._apply_bos_after(blocks, structure)

        active = [b for b in blocks if not b.mitigated]
        last_active = active[-1] if active else (blocks[-1] if blocks else None)

        return OrderBlockSnapshot(
            timeframe=timeframe,
            blocks=blocks,
            last_active=last_active,
            bar_count=n,
            last_close=float(closes[-1]),
        )

    def _apply_lifecycle(
        self,
        blocks: list[OrderBlockRecord],
        opens: list[float],
        highs: list[float],
        lows: list[float],
        closes: list[float],
        ts_list: list[int],
        start: int,
        n: int,
    ) -> list[OrderBlockRecord]:
        updated: list[OrderBlockRecord] = []
        for ob in blocks:
            mitigated = ob.mitigated
            retest = ob.retest_confirmed
            left_zone = False
            for j in range(ob.bar_index + 2, n):
                if ob.direction == OrderBlockDirection.BULLISH:
                    if closes[j] < ob.low:
                        mitigated = True
                    if lows[j] <= ob.high and lows[j] >= ob.low:
                        if left_zone:
                            retest = True
                        mitigated = True
                    if closes[j] > ob.high:
                        left_zone = True
                else:
                    if closes[j] > ob.high:
                        mitigated = True
                    if highs[j] >= ob.low and highs[j] <= ob.high:
                        if left_zone:
                            retest = True
                        mitigated = True
                    if closes[j] < ob.low:
                        left_zone = True

            score = self._score_ob(ob)
            if retest:
                score = min(100.0, score + 8.0)
            if mitigated and not retest:
                score = max(0.0, score - 5.0)

            updated.append(OrderBlockRecord(
                direction=ob.direction,
                high=ob.high,
                low=ob.low,
                ts=ob.ts,
                bar_index=ob.bar_index,
                strength_score=round(score, 2),
                mitigated=mitigated,
                has_displacement=ob.has_displacement,
                has_bos_after=ob.has_bos_after,
                volume_confirmed=ob.volume_confirmed,
                retest_confirmed=retest,
                details=ob.details,
            ))
        return updated

    def _apply_bos_after(
        self,
        blocks: list[OrderBlockRecord],
        structure: MarketStructureSnapshot,
    ) -> list[OrderBlockRecord]:
        events = structure.events
        if not events:
            return blocks
        updated: list[OrderBlockRecord] = []
        for ob in blocks:
            has_bos = any(
                ev.bar_index > ob.bar_index and ev.direction == ob.direction.value
                for ev in events
            )
            score = ob.strength_score
            if has_bos:
                score = min(100.0, score + 10.0)
            updated.append(OrderBlockRecord(
                direction=ob.direction,
                high=ob.high,
                low=ob.low,
                ts=ob.ts,
                bar_index=ob.bar_index,
                strength_score=round(score, 2),
                mitigated=ob.mitigated,
                has_displacement=ob.has_displacement,
                has_bos_after=has_bos,
                volume_confirmed=ob.volume_confirmed,
                retest_confirmed=ob.retest_confirmed,
                details=ob.details,
            ))
        return updated

    def _score_ob(self, ob: OrderBlockRecord) -> float:
        base = 50.0
        if ob.has_displacement:
            base += 15.0
        if ob.volume_confirmed:
            base += 10.0
        if ob.has_bos_after:
            base += 10.0
        if ob.retest_confirmed:
            base += 8.0
        if ob.mitigated and not ob.retest_confirmed:
            base -= 10.0
        return round(min(100.0, max(0.0, base)), 2)

    def to_rows_for_db(
        self,
        snapshot: OrderBlockSnapshot,
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
                "ts": ob.ts,
                "direction": ob.direction.value,
                "high": ob.high,
                "low": ob.low,
                "status": "mitigated" if ob.mitigated else "active",
                "strength_score": ob.strength_score,
                "mitigated": ob.mitigated,
                "has_displacement": ob.has_displacement,
                "has_bos_after": ob.has_bos_after,
                "volume_confirmed": ob.volume_confirmed,
                "retest_confirmed": ob.retest_confirmed,
                "details_json": ob.details,
            }
            for ob in snapshot.blocks[-recent_limit:]
        ]
