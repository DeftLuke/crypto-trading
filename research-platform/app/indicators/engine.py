"""Indicator orchestration — Phase 2."""

import polars as pl

from app.indicators.base import BaseIndicator
from app.indicators.registry import ALL_INDICATORS

# Phase 1 backward compatibility
Indicator = BaseIndicator
DEFAULT_INDICATORS = ALL_INDICATORS
EMAIndicator = type(ALL_INDICATORS[0])
RSIIndicator = type([i for i in ALL_INDICATORS if i.name == "rsi14"][0])
ATRIndicator = type([i for i in ALL_INDICATORS if i.name == "atr14"][0])
MACDIndicator = type([i for i in ALL_INDICATORS if i.name == "macd"][0])
VWAPIndicator = type([i for i in ALL_INDICATORS if i.name == "vwap"][0])


def compute_all_indicators(lf: pl.LazyFrame) -> pl.DataFrame:
    """Join all indicators onto candle LazyFrame."""
    base = lf.collect()
    result = base.select(["ts", "open", "high", "low", "close", "volume"])
    for ind in ALL_INDICATORS:
        if not ind.validate(result):
            continue
        computed = ind.calculate(lf).collect()
        for col in ind.output_columns:
            if col in computed.columns:
                result = result.join(computed.select(["ts", col]), on="ts", how="left")
    return result


def serialize_indicators(row: dict) -> dict:
    """Flatten latest row into standard indicator output."""
    out: dict = {}
    for ind in ALL_INDICATORS:
        out.update(ind.serialize(row))
    if "rsi14" in out:
        out["rsi"] = out["rsi14"]
    if "atr14" in out:
        out["atr"] = out["atr14"]
    return out
