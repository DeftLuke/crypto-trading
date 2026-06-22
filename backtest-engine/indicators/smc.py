"""
Smart Money Concepts (SMC) feature detection for TradeGPT E5.

Implements swing structure, liquidity sweeps, MSS, FVG, and order blocks
in a vectorized / rolling form suitable for candle-by-candle backtests.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def detect_swings(
    df: pd.DataFrame,
    left: int = 3,
    right: int = 3,
) -> pd.DataFrame:
    """Mark swing highs and swing lows."""
    out = df.copy()
    highs = out["high"].values
    lows = out["low"].values
    n = len(out)
    swing_high = np.zeros(n, dtype=bool)
    swing_low = np.zeros(n, dtype=bool)

    for i in range(left, n - right):
        window_h = highs[i - left : i + right + 1]
        window_l = lows[i - left : i + right + 1]
        if highs[i] >= window_h.max():
            swing_high[i] = True
        if lows[i] <= window_l.min():
            swing_low[i] = True

    out["swing_high"] = swing_high
    out["swing_low"] = swing_low
    out["last_swing_high"] = np.where(swing_high, out["high"], np.nan)
    out["last_swing_low"] = np.where(swing_low, out["low"], np.nan)
    out["last_swing_high"] = out["last_swing_high"].ffill()
    out["last_swing_low"] = out["last_swing_low"].ffill()
    return out


def detect_fvg(df: pd.DataFrame) -> pd.DataFrame:
    """
    Fair Value Gap: 3-candle imbalance.
    Bullish FVG when low[i] > high[i-2]; bearish when high[i] < low[i-2].
    """
    out = df.copy()
    high_2 = out["high"].shift(2)
    low_2 = out["low"].shift(2)
    out["bull_fvg"] = out["low"] > high_2
    out["bear_fvg"] = out["high"] < low_2
    out["bull_fvg_top"] = np.where(out["bull_fvg"], out["low"], np.nan)
    out["bull_fvg_bottom"] = np.where(out["bull_fvg"], high_2, np.nan)
    out["bear_fvg_top"] = np.where(out["bear_fvg"], low_2, np.nan)
    out["bear_fvg_bottom"] = np.where(out["bear_fvg"], out["high"], np.nan)
    return out


def detect_order_blocks(df: pd.DataFrame, lookback: int = 30) -> pd.DataFrame:
    """
    Order block = last opposing candle before displacement.
    Bullish OB: last bearish candle before strong up move.
    Bearish OB: last bullish candle before strong down move.
    """
    out = df.copy()
    bearish = out["close"] < out["open"]
    bullish = out["close"] > out["open"]
    displacement_up = out["close"] > out["open"].shift(1) * 1.002
    displacement_down = out["close"] < out["open"].shift(1) * 0.998

    bull_ob_high = pd.Series(np.nan, index=out.index)
    bull_ob_low = pd.Series(np.nan, index=out.index)
    bear_ob_high = pd.Series(np.nan, index=out.index)
    bear_ob_low = pd.Series(np.nan, index=out.index)

    for i in range(lookback, len(out)):
        window = out.iloc[i - lookback : i]
        if displacement_up.iloc[i]:
            bear_candles = window[bearish.iloc[i - lookback : i]]
            if not bear_candles.empty:
                last = bear_candles.iloc[-1]
                bull_ob_high.iloc[i] = last["high"]
                bull_ob_low.iloc[i] = last["low"]
        if displacement_down.iloc[i]:
            bull_candles = window[bullish.iloc[i - lookback : i]]
            if not bull_candles.empty:
                last = bull_candles.iloc[-1]
                bear_ob_high.iloc[i] = last["high"]
                bear_ob_low.iloc[i] = last["low"]

    out["bull_ob_high"] = bull_ob_high.ffill(limit=lookback)
    out["bull_ob_low"] = bull_ob_low.ffill(limit=lookback)
    out["bear_ob_high"] = bear_ob_high.ffill(limit=lookback)
    out["bear_ob_low"] = bear_ob_low.ffill(limit=lookback)
    return out


def detect_liquidity_sweeps(df: pd.DataFrame, lookback: int = 50) -> pd.DataFrame:
    """
    Liquidity sweep: wick beyond prior swing then close back inside.
    """
    out = df.copy()
    prev_swing_low = out["low"].rolling(lookback, min_periods=5).min().shift(1)
    prev_swing_high = out["high"].rolling(lookback, min_periods=5).max().shift(1)

    out["bull_sweep"] = (out["low"] < prev_swing_low) & (out["close"] > prev_swing_low)
    out["bear_sweep"] = (out["high"] > prev_swing_high) & (out["close"] < prev_swing_high)
    out["sweep_low_level"] = np.where(out["bull_sweep"], out["low"], np.nan)
    out["sweep_high_level"] = np.where(out["bear_sweep"], out["high"], np.nan)
    out["sweep_low_level"] = out["sweep_low_level"].ffill(limit=lookback)
    out["sweep_high_level"] = out["sweep_high_level"].ffill(limit=lookback)
    return out


def detect_mss(df: pd.DataFrame, lookback: int = 20) -> pd.DataFrame:
    """
    Market Structure Shift: break of structure after sweep.
    Bullish MSS: close above recent swing high after bull sweep.
    Bearish MSS: close below recent swing low after bear sweep.
    """
    out = df.copy()
    recent_high = out["high"].rolling(lookback, min_periods=5).max().shift(1)
    recent_low = out["low"].rolling(lookback, min_periods=5).min().shift(1)

    had_bull_sweep = out["bull_sweep"].rolling(lookback, min_periods=1).max().astype(bool)
    had_bear_sweep = out["bear_sweep"].rolling(lookback, min_periods=1).max().astype(bool)

    out["bull_mss"] = had_bull_sweep & (out["close"] > recent_high)
    out["bear_mss"] = had_bear_sweep & (out["close"] < recent_low)
    return out


def add_smc_features(
    df: pd.DataFrame,
    swing_left: int = 3,
    swing_right: int = 3,
    fvg_lookback: int = 20,
    ob_lookback: int = 30,
    sweep_lookback: int = 50,
) -> pd.DataFrame:
    """Full SMC pipeline."""
    out = detect_swings(df, swing_left, swing_right)
    out = detect_fvg(out)
    out = detect_order_blocks(out, ob_lookback)
    out = detect_liquidity_sweeps(out, sweep_lookback)
    out = detect_mss(out, fvg_lookback)
    return out
