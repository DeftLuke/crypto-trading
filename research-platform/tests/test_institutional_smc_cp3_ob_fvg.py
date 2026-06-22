"""CP3 tests — Order Blocks + FVG engines."""

from __future__ import annotations

import polars as pl

from app.institutional_smc.modules.fvg import FVGEngine, FVGDirection
from app.institutional_smc.modules.order_blocks import OrderBlockDirection, OrderBlockEngine


def _flat_bars(n: int = 5, price: float = 100.0) -> pl.DataFrame:
    rows = []
    for i in range(n):
        ts = 1_700_000_000_000 + i * 3_600_000
        rows.append({
            "ts": ts, "open": price, "high": price + 0.1, "low": price - 0.1,
            "close": price, "volume": 1000.0,
        })
    return pl.DataFrame(rows)


def _bullish_ob_sequence() -> pl.DataFrame:
    rows = _flat_bars(8, 100.0).to_dicts()
    # Bearish opposing candle
    rows.append({
        "ts": rows[-1]["ts"] + 3_600_000,
        "open": 100.5, "high": 100.6, "low": 99.8, "close": 99.9, "volume": 1200.0,
    })
    # Strong bullish impulse (>0.3%)
    rows.append({
        "ts": rows[-1]["ts"] + 3_600_000,
        "open": 100.0, "high": 101.5, "low": 99.9, "close": 101.2, "volume": 5000.0,
    })
    return pl.DataFrame(rows)


def _bullish_fvg_sequence() -> pl.DataFrame:
    rows = _flat_bars(3, 100.0).to_dicts()
    # i-2 high = 100.1, i-1 drop, i low > i-2 high
    rows[0] = {**rows[0], "open": 99.5, "high": 100.1, "low": 99.4, "close": 100.0}
    rows[1] = {
        "ts": rows[0]["ts"] + 3_600_000,
        "open": 100.0, "high": 100.0, "low": 99.0, "close": 99.2, "volume": 1000.0,
    }
    rows.append({
        "ts": rows[1]["ts"] + 3_600_000,
        "open": 100.5, "high": 101.0, "low": 100.2, "close": 100.8, "volume": 1000.0,
    })
    return pl.DataFrame(rows)


def test_order_block_detects_bullish_ob():
    df = _bullish_ob_sequence()
    snap = OrderBlockEngine(min_impulse_pct=0.002).analyze(df, "1h")
    assert len(snap.blocks) >= 1
    ob = snap.blocks[-1]
    assert ob.direction == OrderBlockDirection.BULLISH
    assert ob.high >= ob.low
    assert 0 <= ob.strength_score <= 100


def test_order_block_explanation_shape():
    df = _bullish_ob_sequence()
    snap = OrderBlockEngine(min_impulse_pct=0.002).analyze(df, "15m")
    exp = snap.to_explanation_dict()
    assert exp["timeframe"] == "15m"
    assert "last_active" in exp


def test_order_block_score_bounded():
    df = _bullish_ob_sequence()
    snap = OrderBlockEngine(min_impulse_pct=0.002).analyze(df, "1h")
    score = snap.ob_score_component("LONG")
    assert 0.0 <= score <= 12.0


def test_order_block_db_rows():
    df = _bullish_ob_sequence()
    engine = OrderBlockEngine(min_impulse_pct=0.002)
    snap = engine.analyze(df, "1h")
    rows = engine.to_rows_for_db(snap, "binance", "BTCUSDT")
    if rows:
        assert rows[0]["symbol"] == "BTCUSDT"
        assert rows[0]["direction"] in ("bullish", "bearish")
        assert "strength_score" in rows[0]


def test_fvg_detects_bullish_gap():
    df = _bullish_fvg_sequence()
    snap = FVGEngine(min_gap_pct=0.0001).analyze(df, "15m")
    assert len(snap.gaps) >= 1
    gap = snap.gaps[-1]
    assert gap.direction == FVGDirection.BULLISH
    assert gap.top > gap.bottom
    assert gap.gap_size > 0


def test_fvg_explanation_shape():
    df = _bullish_fvg_sequence()
    snap = FVGEngine(min_gap_pct=0.0001).analyze(df, "1h")
    exp = snap.to_explanation_dict()
    assert exp["timeframe"] == "1h"
    assert "active_count" in exp


def test_fvg_score_bounded():
    df = _bullish_fvg_sequence()
    snap = FVGEngine(min_gap_pct=0.0001).analyze(df, "15m")
    score = snap.fvg_score_component("LONG")
    assert 0.0 <= score <= 10.0


def test_fvg_db_rows():
    df = _bullish_fvg_sequence()
    engine = FVGEngine(min_gap_pct=0.0001)
    snap = engine.analyze(df, "15m")
    rows = engine.to_rows_for_db(snap, "binance", "ETHUSDT")
    if rows:
        assert rows[0]["symbol"] == "ETHUSDT"
        assert "gap_size" in rows[0]
        assert "fill_percentage" in rows[0]
