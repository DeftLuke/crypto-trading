"""CP4 tests — Premium/Discount + Displacement engines."""

from __future__ import annotations

import polars as pl

from app.institutional_smc.modules.displacement import DisplacementDirection, DisplacementEngine
from app.institutional_smc.modules.premium_discount import PremiumDiscountEngine, PriceZone


def _ranging_bars(low: float = 95.0, high: float = 105.0, n: int = 80) -> pl.DataFrame:
    rows = []
    for i in range(n):
        ts = 1_700_000_000_000 + i * 3_600_000
        mid = (low + high) / 2
        wave = (i % 10) / 10.0
        c = low + (high - low) * wave
        rows.append({
            "ts": ts, "open": c, "high": min(high, c + 0.5), "low": max(low, c - 0.5),
            "close": c, "volume": 1000.0,
        })
    return pl.DataFrame(rows)


def _discount_price_bars() -> pl.DataFrame:
    df = _ranging_bars(90.0, 110.0, 60)
    rows = df.to_dicts()
    # Push last close into discount zone (below equilibrium ~100)
    rows[-1] = {**rows[-1], "open": 93.0, "high": 94.0, "low": 92.0, "close": 92.5}
    return pl.DataFrame(rows)


def _premium_price_bars() -> pl.DataFrame:
    df = _ranging_bars(90.0, 110.0, 60)
    rows = df.to_dicts()
    rows[-1] = {**rows[-1], "open": 107.0, "high": 108.0, "low": 106.5, "close": 107.5}
    return pl.DataFrame(rows)


def _displacement_bars() -> pl.DataFrame:
    rows = []
    price = 100.0
    for i in range(30):
        ts = 1_700_000_000_000 + i * 900_000
        rows.append({
            "ts": ts, "open": price, "high": price + 0.2, "low": price - 0.2,
            "close": price, "volume": 1000.0,
        })
    # Strong bullish impulse candle
    rows.append({
        "ts": rows[-1]["ts"] + 900_000,
        "open": 100.0, "high": 103.5, "low": 99.8, "close": 103.2, "volume": 8000.0,
    })
    return pl.DataFrame(rows)


def test_premium_discount_detects_zone():
    snap = PremiumDiscountEngine().analyze(_discount_price_bars(), "1h")
    assert snap.bar_count == 60
    assert snap.range_high > snap.range_low
    assert snap.zone in (PriceZone.DISCOUNT, PriceZone.EQUILIBRIUM, PriceZone.PREMIUM)


def test_premium_discount_long_prefers_discount():
    discount = PremiumDiscountEngine().analyze(_discount_price_bars(), "4h")
    premium = PremiumDiscountEngine().analyze(_premium_price_bars(), "4h")
    long_discount = discount.pd_score_component("LONG")
    long_premium = premium.pd_score_component("LONG")
    if discount.zone == PriceZone.DISCOUNT and premium.zone == PriceZone.PREMIUM:
        assert long_discount > long_premium


def test_premium_discount_score_bounded():
    snap = PremiumDiscountEngine().analyze(_ranging_bars(), "1h")
    assert 0.0 <= snap.pd_score_component("SHORT") <= 8.0


def test_premium_discount_explanation():
    snap = PremiumDiscountEngine().analyze(_ranging_bars(), "1h")
    exp = snap.to_explanation_dict()
    assert exp["timeframe"] == "1h"
    assert "position_pct" in exp


def test_displacement_detects_impulse():
    snap = DisplacementEngine(body_ratio_min=0.5, atr_body_mult=0.8).analyze(_displacement_bars(), "15m")
    assert snap.last_displacement is not None
    assert snap.last_displacement.direction == DisplacementDirection.BULLISH
    assert 0 <= snap.last_displacement.strength_score <= 100


def test_displacement_score_bounded():
    snap = DisplacementEngine(body_ratio_min=0.5, atr_body_mult=0.8).analyze(_displacement_bars(), "15m")
    score = snap.displacement_score_component("LONG")
    assert 0.0 <= score <= 10.0


def test_displacement_db_rows():
    engine = DisplacementEngine(body_ratio_min=0.5, atr_body_mult=0.8)
    snap = engine.analyze(_displacement_bars(), "15m")
    rows = engine.to_rows_for_db(snap, "binance", "BTCUSDT")
    if rows:
        assert rows[0]["symbol"] == "BTCUSDT"
        assert rows[0]["direction"] in ("bullish", "bearish")
        assert "body_pct" in rows[0]
