"""Classic technical indicators."""

from __future__ import annotations

import pandas as pd


def ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    high = df["high"]
    low = df["low"]
    close = df["close"]
    prev_close = close.shift(1)
    tr = pd.concat(
        [
            high - low,
            (high - prev_close).abs(),
            (low - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return tr.ewm(span=period, adjust=False).mean()


def add_technical_indicators(
    df: pd.DataFrame,
    ema_fast: int = 20,
    ema_mid: int = 50,
    ema_slow: int = 200,
    atr_period: int = 14,
    volume_ema_period: int = 20,
) -> pd.DataFrame:
    """Add EMA 20/50/200, ATR 14, Volume EMA 20."""
    out = df.copy()
    out["ema20"] = ema(out["close"], ema_fast)
    out["ema50"] = ema(out["close"], ema_mid)
    out["ema200"] = ema(out["close"], ema_slow)
    out["atr14"] = atr(out, atr_period)
    out["vol_ema20"] = ema(out["volume"], volume_ema_period)
    return out
