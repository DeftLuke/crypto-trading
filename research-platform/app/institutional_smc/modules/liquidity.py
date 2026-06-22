"""
Liquidity Engine — CP2 Module 2.

Detects equal highs/lows, internal/external liquidity, PDH/PDL, PWH/PWL, session levels.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any

import polars as pl

from app.institutional_smc.constants import LIQUIDITY_QUALITY_POINTS
from app.smc.swings import find_swings


class LiquidityType(str, Enum):
    EQUAL_HIGH = "equal_high"
    EQUAL_LOW = "equal_low"
    INTERNAL_HIGH = "internal_high"
    INTERNAL_LOW = "internal_low"
    EXTERNAL_HIGH = "external_high"
    EXTERNAL_LOW = "external_low"
    PREVIOUS_DAY_HIGH = "previous_day_high"
    PREVIOUS_DAY_LOW = "previous_day_low"
    PREVIOUS_WEEK_HIGH = "previous_week_high"
    PREVIOUS_WEEK_LOW = "previous_week_low"
    SESSION_HIGH = "session_high"
    SESSION_LOW = "session_low"


def _base_strength(liquidity_type: LiquidityType) -> float:
    mapping = {
        LiquidityType.EQUAL_HIGH: LIQUIDITY_QUALITY_POINTS["equal_high"],
        LiquidityType.EQUAL_LOW: LIQUIDITY_QUALITY_POINTS["equal_low"],
        LiquidityType.SESSION_HIGH: LIQUIDITY_QUALITY_POINTS["session"],
        LiquidityType.SESSION_LOW: LIQUIDITY_QUALITY_POINTS["session"],
        LiquidityType.PREVIOUS_DAY_HIGH: LIQUIDITY_QUALITY_POINTS["previous_day"],
        LiquidityType.PREVIOUS_DAY_LOW: LIQUIDITY_QUALITY_POINTS["previous_day"],
        LiquidityType.PREVIOUS_WEEK_HIGH: LIQUIDITY_QUALITY_POINTS["previous_week"],
        LiquidityType.PREVIOUS_WEEK_LOW: LIQUIDITY_QUALITY_POINTS["previous_week"],
        LiquidityType.INTERNAL_HIGH: 15.0,
        LiquidityType.INTERNAL_LOW: 15.0,
        LiquidityType.EXTERNAL_HIGH: 18.0,
        LiquidityType.EXTERNAL_LOW: 18.0,
    }
    return mapping.get(liquidity_type, 15.0)


@dataclass
class LiquidityLevelRecord:
    liquidity_type: LiquidityType
    price: float
    ts: int
    strength_score: float
    taken_status: bool = False
    session_tag: str | None = None
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "liquidity_type": self.liquidity_type.value,
            "price": self.price,
            "ts": self.ts,
            "strength_score": self.strength_score,
            "taken_status": self.taken_status,
            "session_tag": self.session_tag,
            "details": self.details,
        }


@dataclass
class LiquiditySnapshot:
    timeframe: str
    levels: list[LiquidityLevelRecord]
    bar_count: int
    last_close: float

    @property
    def active_levels(self) -> list[LiquidityLevelRecord]:
        return [lv for lv in self.levels if not lv.taken_status]

    def to_explanation_dict(self) -> dict[str, Any]:
        top = sorted(self.active_levels, key=lambda x: x.strength_score, reverse=True)[:8]
        return {
            "status": "pass",
            "timeframe": self.timeframe,
            "level_count": len(self.levels),
            "active_count": len(self.active_levels),
            "top_levels": [lv.to_dict() for lv in top],
        }

    def levels_score_component(self, trade_direction: str | None = None) -> float:
        """Supporting score — used inside sweep module; max ~8 auxiliary points."""
        if not self.active_levels:
            return 0.0
        best = max(lv.strength_score for lv in self.active_levels)
        return min(8.0, best * 0.2)


class LiquidityEngine:
    """Detect institutional liquidity pools on OHLCV data."""

    def __init__(
        self,
        swing_lookback: int = 3,
        eq_tolerance_pct: float = 0.0015,
        cluster_tolerance_pct: float = 0.002,
    ) -> None:
        self.swing_lookback = swing_lookback
        self.eq_tolerance_pct = eq_tolerance_pct
        self.cluster_tolerance_pct = cluster_tolerance_pct

    def analyze(
        self,
        df: pl.DataFrame,
        timeframe: str,
        *,
        daily_df: pl.DataFrame | None = None,
    ) -> LiquiditySnapshot:
        if df.is_empty():
            return LiquiditySnapshot(timeframe=timeframe, levels=[], bar_count=0, last_close=0.0)

        df = df.sort("ts")
        ts_list = df["ts"].to_list()
        highs = df["high"].to_list()
        lows = df["low"].to_list()
        closes = df["close"].to_list()
        last_ts = int(ts_list[-1])
        last_close = float(closes[-1])

        levels: list[LiquidityLevelRecord] = []
        swing_highs, swing_lows = find_swings(highs, lows, ts_list, self.swing_lookback)

        levels.extend(self._equal_levels(swing_highs, swing_lows, last_ts))
        levels.extend(self._internal_external(swing_highs, swing_lows, last_ts))

        if daily_df is not None and not daily_df.is_empty():
            levels.extend(self._previous_day_levels(daily_df, last_ts))
            levels.extend(self._previous_week_levels(daily_df, last_ts))

        levels.extend(self._session_levels(df, last_ts))

        levels = self._apply_cluster_boost(levels)
        levels = self._mark_taken_levels(levels, highs, lows, closes)

        return LiquiditySnapshot(
            timeframe=timeframe,
            levels=levels,
            bar_count=len(df),
            last_close=last_close,
        )

    def _equal_levels(self, swing_highs, swing_lows, anchor_ts: int) -> list[LiquidityLevelRecord]:
        out: list[LiquidityLevelRecord] = []
        for group, ltype in ((self._cluster_prices([s.price for s in swing_highs]), LiquidityType.EQUAL_HIGH),
                             (self._cluster_prices([s.price for s in swing_lows]), LiquidityType.EQUAL_LOW)):
            for price in group:
                out.append(LiquidityLevelRecord(
                    liquidity_type=ltype,
                    price=price,
                    ts=anchor_ts,
                    strength_score=_base_strength(ltype),
                    details={"source": "swing_cluster"},
                ))
        return out

    def _cluster_prices(self, prices: list[float]) -> list[float]:
        if len(prices) < 2:
            return []
        sorted_prices = sorted(prices)
        clusters: list[list[float]] = []
        for px in sorted_prices:
            placed = False
            for cluster in clusters:
                ref = cluster[0]
                if ref and abs(px - ref) / ref <= self.eq_tolerance_pct:
                    cluster.append(px)
                    placed = True
                    break
            if not placed:
                clusters.append([px])
        return [sum(c) / len(c) for c in clusters if len(c) >= 2]

    def _internal_external(self, swing_highs, swing_lows, anchor_ts: int) -> list[LiquidityLevelRecord]:
        out: list[LiquidityLevelRecord] = []
        if swing_highs:
            ext_h = max(s.price for s in swing_highs[-5:])
            out.append(LiquidityLevelRecord(
                liquidity_type=LiquidityType.EXTERNAL_HIGH,
                price=ext_h,
                ts=anchor_ts,
                strength_score=_base_strength(LiquidityType.EXTERNAL_HIGH),
            ))
            if len(swing_highs) >= 2:
                internal = swing_highs[-2].price
                out.append(LiquidityLevelRecord(
                    liquidity_type=LiquidityType.INTERNAL_HIGH,
                    price=internal,
                    ts=anchor_ts,
                    strength_score=_base_strength(LiquidityType.INTERNAL_HIGH),
                ))
        if swing_lows:
            ext_l = min(s.price for s in swing_lows[-5:])
            out.append(LiquidityLevelRecord(
                liquidity_type=LiquidityType.EXTERNAL_LOW,
                price=ext_l,
                ts=anchor_ts,
                strength_score=_base_strength(LiquidityType.EXTERNAL_LOW),
            ))
            if len(swing_lows) >= 2:
                internal = swing_lows[-2].price
                out.append(LiquidityLevelRecord(
                    liquidity_type=LiquidityType.INTERNAL_LOW,
                    price=internal,
                    ts=anchor_ts,
                    strength_score=_base_strength(LiquidityType.INTERNAL_LOW),
                ))
        return out

    def _previous_day_levels(self, daily_df: pl.DataFrame, anchor_ts: int) -> list[LiquidityLevelRecord]:
        daily = daily_df.sort("ts")
        if len(daily) < 2:
            return []
        prev = daily.row(-2, named=True)
        return [
            LiquidityLevelRecord(
                liquidity_type=LiquidityType.PREVIOUS_DAY_HIGH,
                price=float(prev["high"]),
                ts=anchor_ts,
                strength_score=_base_strength(LiquidityType.PREVIOUS_DAY_HIGH),
                details={"day_ts": int(prev["ts"])},
            ),
            LiquidityLevelRecord(
                liquidity_type=LiquidityType.PREVIOUS_DAY_LOW,
                price=float(prev["low"]),
                ts=anchor_ts,
                strength_score=_base_strength(LiquidityType.PREVIOUS_DAY_LOW),
                details={"day_ts": int(prev["ts"])},
            ),
        ]

    def _previous_week_levels(self, daily_df: pl.DataFrame, anchor_ts: int) -> list[LiquidityLevelRecord]:
        daily = daily_df.sort("ts")
        if len(daily) < 8:
            return []
        rows = daily.to_dicts()
        weeks: dict[tuple[int, int], list[dict]] = {}
        for row in rows:
            dt = datetime.fromtimestamp(row["ts"] / 1000, tz=timezone.utc)
            key = (dt.isocalendar().year, dt.isocalendar().week)
            weeks.setdefault(key, []).append(row)
        keys = sorted(weeks.keys())
        if len(keys) < 2:
            return []
        prev_week = weeks[keys[-2]]
        wh = max(r["high"] for r in prev_week)
        wl = min(r["low"] for r in prev_week)
        return [
            LiquidityLevelRecord(
                liquidity_type=LiquidityType.PREVIOUS_WEEK_HIGH,
                price=float(wh),
                ts=anchor_ts,
                strength_score=_base_strength(LiquidityType.PREVIOUS_WEEK_HIGH),
            ),
            LiquidityLevelRecord(
                liquidity_type=LiquidityType.PREVIOUS_WEEK_LOW,
                price=float(wl),
                ts=anchor_ts,
                strength_score=_base_strength(LiquidityType.PREVIOUS_WEEK_LOW),
            ),
        ]

    def _session_levels(self, df: pl.DataFrame, anchor_ts: int) -> list[LiquidityLevelRecord]:
        """London / NY session highs and lows for the current UTC day."""
        dt = datetime.fromtimestamp(anchor_ts / 1000, tz=timezone.utc)
        day_start = datetime(dt.year, dt.month, dt.day, tzinfo=timezone.utc)
        day_start_ms = int(day_start.timestamp() * 1000)
        day_rows = df.filter(pl.col("ts") >= day_start_ms)
        if day_rows.is_empty():
            return []

        session_tag = self._session_tag(dt.hour)
        if not session_tag:
            return []

        sub = day_rows.filter(pl.col("ts") >= day_start_ms)
        highs = sub["high"].to_list()
        lows = sub["low"].to_list()
        if not highs:
            return []

        return [
            LiquidityLevelRecord(
                liquidity_type=LiquidityType.SESSION_HIGH,
                price=float(max(highs)),
                ts=anchor_ts,
                strength_score=_base_strength(LiquidityType.SESSION_HIGH),
                session_tag=session_tag,
            ),
            LiquidityLevelRecord(
                liquidity_type=LiquidityType.SESSION_LOW,
                price=float(min(lows)),
                ts=anchor_ts,
                strength_score=_base_strength(LiquidityType.SESSION_LOW),
                session_tag=session_tag,
            ),
        ]

    @staticmethod
    def _session_tag(hour_utc: int) -> str | None:
        if 13 <= hour_utc < 16:
            return "london_ny_overlap"
        if 7 <= hour_utc < 10:
            return "london_open"
        if 13 <= hour_utc < 17:
            return "ny_open"
        return None

    def _apply_cluster_boost(self, levels: list[LiquidityLevelRecord]) -> list[LiquidityLevelRecord]:
        if len(levels) < 2:
            return levels
        mult_conf = LIQUIDITY_QUALITY_POINTS["multiple_confirmation"]
        for i, lv in enumerate(levels):
            confirmations = 0
            for other in levels:
                if other is lv:
                    continue
                if lv.price <= 0:
                    continue
                if abs(other.price - lv.price) / lv.price <= self.cluster_tolerance_pct:
                    confirmations += 1
            if confirmations >= 1:
                levels[i] = LiquidityLevelRecord(
                    liquidity_type=lv.liquidity_type,
                    price=lv.price,
                    ts=lv.ts,
                    strength_score=min(mult_conf, lv.strength_score + 10 * confirmations),
                    taken_status=lv.taken_status,
                    session_tag=lv.session_tag,
                    details={**lv.details, "confirmations": confirmations + 1},
                )
        return levels

    def _mark_taken_levels(
        self,
        levels: list[LiquidityLevelRecord],
        highs: list[float],
        lows: list[float],
        closes: list[float],
    ) -> list[LiquidityLevelRecord]:
        """Mark levels swept on the latest bar."""
        if not levels or not highs:
            return levels
        h, l, c = highs[-1], lows[-1], closes[-1]
        updated: list[LiquidityLevelRecord] = []
        for lv in levels:
            taken = False
            if lv.liquidity_type.value.endswith("_high") or "high" in lv.liquidity_type.value:
                taken = h > lv.price and c < lv.price
            elif lv.liquidity_type.value.endswith("_low") or "low" in lv.liquidity_type.value:
                taken = l < lv.price and c > lv.price
            updated.append(LiquidityLevelRecord(
                liquidity_type=lv.liquidity_type,
                price=lv.price,
                ts=lv.ts,
                strength_score=lv.strength_score,
                taken_status=taken,
                session_tag=lv.session_tag,
                details=lv.details,
            ))
        return updated

    def to_rows_for_db(
        self,
        snapshot: LiquiditySnapshot,
        exchange: str,
        symbol: str,
    ) -> list[dict[str, Any]]:
        sym = symbol.upper()
        return [
            {
                "exchange": exchange,
                "symbol": sym,
                "timeframe": snapshot.timeframe,
                "ts": lv.ts,
                "liquidity_type": lv.liquidity_type.value,
                "price": lv.price,
                "status": "taken" if lv.taken_status else "active",
                "strength_score": lv.strength_score,
                "taken_status": lv.taken_status,
                "session_tag": lv.session_tag,
                "details_json": lv.details,
            }
            for lv in snapshot.levels
        ]
