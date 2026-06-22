"""Market Structure Engine — CP1.

Detects HH/HL/LH/LL, bullish/bearish/range structure, and BOS/MSS/CHOCH events.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

import polars as pl

from app.smc.swings import find_swings


class StructureState(str, Enum):
    BULLISH = "bullish"
    BEARISH = "bearish"
    RANGE = "range"


class EventType(str, Enum):
    BOS = "BOS"
    MSS = "MSS"
    CHOCH = "CHOCH"


class SwingLabel(str, Enum):
    HH = "HH"
    HL = "HL"
    LH = "LH"
    LL = "LL"


@dataclass
class LabeledSwing:
    label: SwingLabel
    kind: str
    price: float
    ts: int
    index: int


@dataclass
class StructureEventRecord:
    event_type: EventType
    direction: str
    price: float
    ts: int
    strength: float
    structure_state: StructureState
    bar_index: int
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "event_type": self.event_type.value,
            "direction": self.direction,
            "price": self.price,
            "ts": self.ts,
            "strength": self.strength,
            "structure_state": self.structure_state.value,
            "bar_index": self.bar_index,
            "details": self.details,
        }


@dataclass
class MarketStructureSnapshot:
    timeframe: str
    structure_state: StructureState
    swing_labels: list[LabeledSwing]
    events: list[StructureEventRecord]
    trend: str
    last_event: StructureEventRecord | None
    last_close: float
    bar_count: int

    @property
    def last_swing_summary(self) -> list[dict[str, Any]]:
        return [
            {"label": s.label.value, "kind": s.kind, "price": s.price, "ts": s.ts}
            for s in self.swing_labels[-6:]
        ]

    def to_explanation_dict(self) -> dict[str, Any]:
        ev = self.last_event.to_dict() if self.last_event else None
        return {
            "status": "pass",
            "timeframe": self.timeframe,
            "structure_state": self.structure_state.value,
            "trend": self.trend,
            "swing_labels": self.last_swing_summary,
            "recent_events": [e.to_dict() for e in self.events[-5:]],
            "last_event": ev,
            "event_count": len(self.events),
            "bar_count": self.bar_count,
        }

    def structure_score_component(self, trade_direction: str | None = None) -> float:
        if self.structure_state == StructureState.RANGE:
            base = 4.0
        else:
            base = 8.0
            if self.last_event:
                base += min(12.0, self.last_event.strength * 0.12)
        if trade_direction:
            want = "bullish" if trade_direction.upper() in ("LONG", "BUY") else "bearish"
            if self.structure_state.value == want:
                base += 4.0
            elif self.structure_state != StructureState.RANGE:
                base *= 0.25
        return min(20.0, base)


class MarketStructureEngine:
    """Institutional market structure analysis on OHLCV bars."""

    def __init__(
        self,
        swing_lookback: int = 3,
        mss_lookback: int = 20,
        range_label_window: int = 4,
    ) -> None:
        self.swing_lookback = swing_lookback
        self.mss_lookback = mss_lookback
        self.range_label_window = range_label_window

    def analyze(self, df: pl.DataFrame, timeframe: str = "1h") -> MarketStructureSnapshot:
        if df.is_empty() or len(df) < self.swing_lookback * 2 + 5:
            return MarketStructureSnapshot(
                timeframe=timeframe,
                structure_state=StructureState.RANGE,
                swing_labels=[],
                events=[],
                trend="neutral",
                last_event=None,
                last_close=float(df["close"][-1]) if not df.is_empty() else 0.0,
                bar_count=len(df),
            )

        df = df.sort("ts")
        ts_list = df["ts"].to_list()
        opens = df["open"].to_list()
        highs = df["high"].to_list()
        lows = df["low"].to_list()
        closes = df["close"].to_list()
        n = len(ts_list)

        swing_highs, swing_lows = find_swings(highs, lows, ts_list, self.swing_lookback)
        labeled = self._label_swings(swing_highs, swing_lows)
        structure_state = self._classify_structure(labeled)

        events: list[StructureEventRecord] = []
        trend = StructureState.RANGE.value
        last_sh_idx = -1
        last_sl_idx = -1
        sh_ptr, sl_ptr = 0, 0
        bull_sweeps: list[int] = []
        bear_sweeps: list[int] = []

        for i in range(n):
            while sh_ptr < len(swing_highs) and swing_highs[sh_ptr].index <= i:
                last_sh_idx = swing_highs[sh_ptr].index
                sh_ptr += 1
            while sl_ptr < len(swing_lows) and swing_lows[sl_ptr].index <= i:
                last_sl_idx = swing_lows[sl_ptr].index
                sl_ptr += 1

            if last_sl_idx >= 0 and lows[i] < lows[last_sl_idx] and closes[i] > lows[last_sl_idx]:
                bull_sweeps.append(i)
            if last_sh_idx >= 0 and highs[i] > highs[last_sh_idx] and closes[i] < highs[last_sh_idx]:
                bear_sweeps.append(i)

            had_bull_sweep = any(i - s <= self.mss_lookback for s in bull_sweeps)
            had_bear_sweep = any(i - s <= self.mss_lookback for s in bear_sweeps)

            event: StructureEventRecord | None = None

            if had_bull_sweep and last_sh_idx >= 0 and closes[i] > highs[last_sh_idx]:
                event = self._make_event(
                    EventType.MSS, "bullish", highs[last_sh_idx], ts_list[i], i,
                    opens[i], highs[i], lows[i], closes[i], structure_state,
                    {"sweep_before_break": True},
                )
                trend = StructureState.BULLISH.value
            elif had_bear_sweep and last_sl_idx >= 0 and closes[i] < lows[last_sl_idx]:
                event = self._make_event(
                    EventType.MSS, "bearish", lows[last_sl_idx], ts_list[i], i,
                    opens[i], highs[i], lows[i], closes[i], structure_state,
                    {"sweep_before_break": True},
                )
                trend = StructureState.BEARISH.value
            elif last_sh_idx >= 0 and closes[i] > highs[last_sh_idx]:
                if trend == StructureState.BEARISH.value:
                    event = self._make_event(
                        EventType.CHOCH, "bullish", highs[last_sh_idx], ts_list[i], i,
                        opens[i], highs[i], lows[i], closes[i], structure_state,
                    )
                else:
                    event = self._make_event(
                        EventType.BOS, "bullish", highs[last_sh_idx], ts_list[i], i,
                        opens[i], highs[i], lows[i], closes[i], structure_state,
                    )
                trend = StructureState.BULLISH.value
            elif last_sl_idx >= 0 and closes[i] < lows[last_sl_idx]:
                if trend == StructureState.BULLISH.value:
                    event = self._make_event(
                        EventType.CHOCH, "bearish", lows[last_sl_idx], ts_list[i], i,
                        opens[i], highs[i], lows[i], closes[i], structure_state,
                    )
                else:
                    event = self._make_event(
                        EventType.BOS, "bearish", lows[last_sl_idx], ts_list[i], i,
                        opens[i], highs[i], lows[i], closes[i], structure_state,
                    )
                trend = StructureState.BEARISH.value

            if event:
                events.append(event)

        last_event = events[-1] if events else None
        if trend == StructureState.RANGE.value and structure_state != StructureState.RANGE:
            trend = structure_state.value

        return MarketStructureSnapshot(
            timeframe=timeframe,
            structure_state=structure_state,
            swing_labels=labeled,
            events=events,
            trend=trend,
            last_event=last_event,
            last_close=float(closes[-1]),
            bar_count=n,
        )

    def _label_swings(self, swing_highs, swing_lows) -> list[LabeledSwing]:
        labeled: list[LabeledSwing] = []
        merged = sorted(
            [(sh.index, "high", sh.price, sh.ts) for sh in swing_highs]
            + [(sl.index, "low", sl.price, sl.ts) for sl in swing_lows],
            key=lambda x: x[0],
        )
        prev_high: float | None = None
        prev_low: float | None = None
        for index, kind, price, ts in merged:
            if kind == "high":
                label = SwingLabel.HH if prev_high is None or price > prev_high else SwingLabel.LH
                prev_high = price
            else:
                label = SwingLabel.HL if prev_low is None or price > prev_low else SwingLabel.LL
                prev_low = price
            labeled.append(LabeledSwing(label=label, kind=kind, price=price, ts=ts, index=index))
        return labeled

    def _classify_structure(self, labeled: list[LabeledSwing]) -> StructureState:
        if len(labeled) < 2:
            return StructureState.RANGE
        recent = labeled[-self.range_label_window :]
        hh = sum(1 for s in recent if s.label == SwingLabel.HH)
        hl = sum(1 for s in recent if s.label == SwingLabel.HL)
        lh = sum(1 for s in recent if s.label == SwingLabel.LH)
        ll = sum(1 for s in recent if s.label == SwingLabel.LL)
        bull_pts = hh + hl
        bear_pts = lh + ll
        if bull_pts >= bear_pts + 2 and hh + hl >= 2:
            return StructureState.BULLISH
        if bear_pts >= bull_pts + 2 and lh + ll >= 2:
            return StructureState.BEARISH
        return StructureState.RANGE

    def _make_event(
        self,
        event_type: EventType,
        direction: str,
        level_price: float,
        ts: int,
        bar_index: int,
        open_p: float,
        high: float,
        low: float,
        close: float,
        structure_state: StructureState,
        extra: dict | None = None,
    ) -> StructureEventRecord:
        body = abs(close - open_p)
        rng = max(high - low, 1e-12)
        displacement = body / rng
        base = {EventType.BOS: 55.0, EventType.CHOCH: 72.0, EventType.MSS: 88.0}[event_type]
        strength = min(100.0, base + displacement * 12.0)
        details: dict[str, Any] = {"displacement_ratio": round(displacement, 4), "break_level": level_price}
        if extra:
            details.update(extra)
        return StructureEventRecord(
            event_type=event_type,
            direction=direction,
            price=close,
            ts=ts,
            strength=round(strength, 2),
            structure_state=structure_state,
            bar_index=bar_index,
            details=details,
        )

    def to_rows_for_db(
        self,
        snapshot: MarketStructureSnapshot,
        exchange: str,
        symbol: str,
        *,
        recent_limit: int = 50,
    ) -> list[dict[str, Any]]:
        sym = symbol.upper()
        return [
            {
                "exchange": exchange,
                "symbol": sym,
                "timeframe": snapshot.timeframe,
                "ts": ev.ts,
                "event_type": ev.event_type.value,
                "direction": ev.direction,
                "price": ev.price,
                "strength": ev.strength,
                "structure_state": ev.structure_state.value,
                "details_json": ev.details,
            }
            for ev in snapshot.events[-recent_limit:]
        ]
