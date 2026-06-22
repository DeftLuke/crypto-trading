"""CP1 tests — Market Structure Engine."""

from __future__ import annotations

import polars as pl

from app.institutional_smc.modules.structure import (
    EventType,
    MarketStructureEngine,
    StructureState,
    SwingLabel,
)


def _make_uptrend_bars(n: int = 80, start: float = 100.0) -> pl.DataFrame:
    rows = []
    price = start
    for i in range(n):
        ts = 1_700_000_000_000 + i * 3_600_000
        drift = 0.15 if i % 7 != 0 else -0.4
        o = price
        c = price + drift
        h = max(o, c) + 0.2
        l = min(o, c) - 0.15
        rows.append({"ts": ts, "open": o, "high": h, "low": l, "close": c, "volume": 1000.0})
        price = c
    return pl.DataFrame(rows)


def _make_reversal_bars() -> pl.DataFrame:
    up = _make_uptrend_bars(50, 100.0)
    rows = up.to_dicts()
    price = rows[-1]["close"]
    for i in range(30):
        ts = rows[-1]["ts"] + (i + 1) * 3_600_000
        o = price
        c = price - 0.8
        h = o + 0.1
        l = c - 0.2
        rows.append({"ts": ts, "open": o, "high": h, "low": l, "close": c, "volume": 1200.0})
        price = c
    return pl.DataFrame(rows)


def test_swing_labels_detect_hh_hl():
    engine = MarketStructureEngine(swing_lookback=2)
    snap = engine.analyze(_make_uptrend_bars(60), "1h")
    labels = {s.label for s in snap.swing_labels}
    assert SwingLabel.HH in labels or SwingLabel.HL in labels
    assert len(snap.swing_labels) >= 2


def test_bullish_structure_or_events_in_uptrend():
    engine = MarketStructureEngine(swing_lookback=2)
    snap = engine.analyze(_make_uptrend_bars(90), "4h")
    assert snap.bar_count == 90
    assert len(snap.events) >= 1
    assert snap.last_event.event_type in (EventType.BOS, EventType.CHOCH, EventType.MSS)


def test_bearish_events_after_reversal():
    engine = MarketStructureEngine(swing_lookback=2)
    snap = engine.analyze(_make_reversal_bars(), "1h")
    bear_events = [e for e in snap.events if e.direction == "bearish"]
    assert len(bear_events) >= 1


def test_event_strength_bounded():
    engine = MarketStructureEngine()
    snap = engine.analyze(_make_uptrend_bars(100), "1h")
    for ev in snap.events:
        assert 0 <= ev.strength <= 100


def test_explanation_dict_shape():
    engine = MarketStructureEngine()
    snap = engine.analyze(_make_uptrend_bars(70), "15m")
    exp = snap.to_explanation_dict()
    assert exp["status"] == "pass"
    assert exp["timeframe"] == "15m"


def test_db_rows_format():
    engine = MarketStructureEngine()
    snap = engine.analyze(_make_uptrend_bars(70), "1h")
    rows = engine.to_rows_for_db(snap, "binance", "BTCUSDT", recent_limit=10)
    if snap.events:
        assert rows[0]["symbol"] == "BTCUSDT"
        assert rows[0]["event_type"] in ("BOS", "MSS", "CHOCH")
