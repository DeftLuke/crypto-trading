"""CP2 tests — Liquidity + Sweep engines."""

from __future__ import annotations

import polars as pl

from app.institutional_smc.modules.liquidity import LiquidityEngine, LiquidityType
from app.institutional_smc.modules.sweeps import SweepDirection, SweepEngine, SweepType


def _swingy_bars(n: int = 60, base: float = 100.0) -> pl.DataFrame:
    rows = []
    price = base
    for i in range(n):
        ts = 1_700_000_000_000 + i * 3_600_000
        wave = 1.5 if i % 5 == 0 else -0.3 if i % 5 == 2 else 0.4
        o = price
        c = price + wave
        h = max(o, c) + (0.8 if i % 5 == 0 else 0.2)
        l = min(o, c) - (0.8 if i % 5 == 2 else 0.2)
        rows.append({"ts": ts, "open": o, "high": h, "low": l, "close": c, "volume": 1000.0})
        price = c
    return pl.DataFrame(rows)


def _daily_from_intraday(df: pl.DataFrame) -> pl.DataFrame:
    return (
        df.group_by((pl.col("ts") // 86_400_000).alias("day"))
        .agg(
            pl.col("ts").min().alias("ts"),
            pl.col("open").first().alias("open"),
            pl.col("high").max().alias("high"),
            pl.col("low").min().alias("low"),
            pl.col("close").last().alias("close"),
            pl.col("volume").sum().alias("volume"),
        )
        .sort("ts")
    )


def test_liquidity_detects_levels():
    df = _swingy_bars(80)
    daily = _daily_from_intraday(df)
    snap = LiquidityEngine(swing_lookback=2).analyze(df, "1h", daily_df=daily)
    assert snap.bar_count == 80
    assert len(snap.levels) >= 2
    types = {lv.liquidity_type for lv in snap.levels}
    assert LiquidityType.EXTERNAL_HIGH in types or LiquidityType.EQUAL_HIGH in types


def test_liquidity_explanation_shape():
    df = _swingy_bars(50)
    snap = LiquidityEngine().analyze(df, "15m")
    exp = snap.to_explanation_dict()
    assert exp["status"] == "pass"
    assert exp["timeframe"] == "15m"
    assert "top_levels" in exp


def test_liquidity_db_rows():
    df = _swingy_bars(40)
    engine = LiquidityEngine()
    snap = engine.analyze(df, "1h")
    rows = engine.to_rows_for_db(snap, "binance", "ETHUSDT")
    if rows:
        assert rows[0]["symbol"] == "ETHUSDT"
        assert "strength_score" in rows[0]
        assert "details_json" in rows[0]


def test_sweep_detects_sellside_on_high_pool():
    df = _swingy_bars(30, base=100.0)
    liq_engine = LiquidityEngine(swing_lookback=2)
    liq = liq_engine.analyze(df, "15m")
    high_levels = [lv for lv in liq.levels if "high" in lv.liquidity_type.value]
    assert high_levels, "need at least one high liquidity pool"

    level_price = max(lv.price for lv in high_levels)
    last = df.row(-1, named=True)
    sweep_bar = {
        "ts": last["ts"] + 900_000,
        "open": level_price - 0.5,
        "high": level_price + 0.25,
        "low": level_price - 0.8,
        "close": level_price - 0.4,
        "volume": 5000.0,
    }
    df2 = pl.concat([df, pl.DataFrame([sweep_bar])])
    liq2 = liq_engine.analyze(df2, "15m")
    sweep_snap = SweepEngine().analyze(df2, liq2, "15m")

    assert sweep_snap.last_sweep is not None
    assert sweep_snap.last_sweep.sweep_direction == SweepDirection.SELLSIDE
    assert sweep_snap.last_sweep.sweep_type in (SweepType.WEAK, SweepType.STRONG)
    assert 0 <= sweep_snap.last_sweep.score <= 100


def test_sweep_score_component_bounded():
    df = _swingy_bars(25)
    liq = LiquidityEngine().analyze(df, "15m")
    sweep_snap = SweepEngine().analyze(df, liq, "15m")
    score = sweep_snap.sweep_score_component("LONG")
    assert 0.0 <= score <= 20.0


def test_sweep_db_rows():
    df = _swingy_bars(35)
    liq_engine = LiquidityEngine()
    liq = liq_engine.analyze(df, "1h")
    sweep_engine = SweepEngine()
    snap = sweep_engine.analyze(df, liq, "1h")
    rows = sweep_engine.to_rows_for_db(snap, "binance", "BTCUSDT")
    for row in rows:
        assert row["symbol"] == "BTCUSDT"
        assert row["sweep_direction"] in ("buyside", "sellside")
