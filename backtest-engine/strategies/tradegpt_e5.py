"""
TradeGPT E5 — SMC multi-timeframe strategy.

Long: HTF bullish + liquidity sweep + MSS + FVG + OB retest + volume filter.
Short: HTF bearish + mirrored conditions.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal

import numpy as np
import pandas as pd

from config.settings import Settings
from data.processor import merge_htf_onto_ltf
from indicators.smc import add_smc_features
from indicators.technical import add_technical_indicators

logger = logging.getLogger(__name__)

Side = Literal["long", "short"]


@dataclass
class Signal:
    index: int
    datetime: pd.Timestamp
    side: Side
    entry: float
    stop_loss: float
    tp1: float
    tp2: float
    tp3: float
    risk_per_unit: float


def _recent_flag(series: pd.Series, i: int, lookback: int) -> bool:
    start = max(0, i - lookback)
    return bool(series.iloc[start : i + 1].any())


def _recent_bull_fvg(df: pd.DataFrame, i: int, lookback: int) -> bool:
    start = max(0, i - lookback)
    return bool(df["bull_fvg"].iloc[start:i].any())


def _recent_bear_fvg(df: pd.DataFrame, i: int, lookback: int) -> bool:
    start = max(0, i - lookback)
    return bool(df["bear_fvg"].iloc[start:i].any())


def _ob_retest_long(row: pd.Series, price_tol: float = 0.001) -> bool:
    ob_high = row.get("bull_ob_high")
    ob_low = row.get("bull_ob_low")
    if pd.isna(ob_high) or pd.isna(ob_low):
        return False
    return float(ob_low) * (1 - price_tol) <= float(row["low"]) <= float(ob_high) * (1 + price_tol)


def _ob_retest_short(row: pd.Series, price_tol: float = 0.001) -> bool:
    ob_high = row.get("bear_ob_high")
    ob_low = row.get("bear_ob_low")
    if pd.isna(ob_high) or pd.isna(ob_low):
        return False
    return float(ob_low) * (1 - price_tol) <= float(row["high"]) <= float(ob_high) * (1 + price_tol)


def build_feature_frame(
    ltf: pd.DataFrame,
    htf: pd.DataFrame,
    settings: Settings,
) -> pd.DataFrame:
    """Prepare LTF dataframe with HTF trend, indicators, and SMC features."""
    ltf_ind = add_technical_indicators(
        ltf,
        ema_fast=settings.ema_fast,
        ema_mid=settings.ema_mid,
        ema_slow=settings.ema_slow,
        atr_period=settings.atr_period,
        volume_ema_period=settings.volume_ema_period,
    )
    ltf_smc = add_smc_features(
        ltf_ind,
        swing_left=settings.swing_left,
        swing_right=settings.swing_right,
        fvg_lookback=settings.fvg_lookback,
        ob_lookback=settings.ob_lookback,
        sweep_lookback=settings.sweep_lookback,
    )

    htf_ind = add_technical_indicators(
        htf,
        ema_fast=settings.ema_fast,
        ema_mid=settings.ema_mid,
        ema_slow=settings.ema_slow,
        atr_period=settings.atr_period,
        volume_ema_period=settings.volume_ema_period,
    )
    merged = merge_htf_onto_ltf(ltf_smc, htf_ind[["datetime", "close", "ema200"]], suffix="_htf")
    merged["htf_bullish"] = merged["close_htf"] > merged["ema200_htf"]
    merged["htf_bearish"] = merged["close_htf"] < merged["ema200_htf"]
    return merged


def generate_signals(df: pd.DataFrame, settings: Settings) -> list[Signal]:
    """Scan candle-by-candle and produce E5 entry signals."""
    signals: list[Signal] = []
    warmup = max(settings.ema_slow, settings.sweep_lookback, settings.ob_lookback) + 5

    for i in range(warmup, len(df)):
        row = df.iloc[i]
        vol_ok = float(row["volume"]) > float(row["vol_ema20"])

        # --- Long setup ---
        if (
            bool(row.get("htf_bullish", False))
            and _recent_flag(df["bull_sweep"], i, 15)
            and (bool(row.get("bull_mss", False)) or _recent_flag(df["bull_mss"], i, 5))
            and _recent_bull_fvg(df, i, settings.fvg_lookback)
            and _ob_retest_long(row)
            and vol_ok
        ):
            entry = float(row["close"])
            sweep_low = float(row.get("sweep_low_level") or row["low"])
            sl = sweep_low * 0.999
            risk = entry - sl
            if risk <= 0:
                continue
            tp1 = entry + risk * settings.tp1_rr
            tp2 = entry + risk * settings.tp2_rr
            liq_zone = float(row.get("last_swing_high") or entry + risk * settings.tp2_rr)
            tp3 = max(liq_zone, tp2 * 1.05)
            signals.append(
                Signal(
                    index=i,
                    datetime=row["datetime"],
                    side="long",
                    entry=entry,
                    stop_loss=sl,
                    tp1=tp1,
                    tp2=tp2,
                    tp3=tp3,
                    risk_per_unit=risk,
                ),
            )
            continue

        # --- Short setup ---
        if (
            bool(row.get("htf_bearish", False))
            and _recent_flag(df["bear_sweep"], i, 15)
            and (bool(row.get("bear_mss", False)) or _recent_flag(df["bear_mss"], i, 5))
            and _recent_bear_fvg(df, i, settings.fvg_lookback)
            and _ob_retest_short(row)
            and vol_ok
        ):
            entry = float(row["close"])
            sweep_high = float(row.get("sweep_high_level") or row["high"])
            sl = sweep_high * 1.001
            risk = sl - entry
            if risk <= 0:
                continue
            tp1 = entry - risk * settings.tp1_rr
            tp2 = entry - risk * settings.tp2_rr
            liq_zone = float(row.get("last_swing_low") or entry - risk * settings.tp2_rr)
            tp3 = min(liq_zone, tp2 * 0.95)
            signals.append(
                Signal(
                    index=i,
                    datetime=row["datetime"],
                    side="short",
                    entry=entry,
                    stop_loss=sl,
                    tp1=tp1,
                    tp2=tp2,
                    tp3=tp3,
                    risk_per_unit=risk,
                ),
            )

    logger.info("E5 generated %d signals", len(signals))
    return signals


def signals_to_dataframe(signals: list[Signal]) -> pd.DataFrame:
    if not signals:
        return pd.DataFrame(
            columns=[
                "datetime", "side", "entry", "stop_loss", "tp1", "tp2", "tp3", "risk_per_unit", "bar_index",
            ],
        )
    return pd.DataFrame(
        [
            {
                "datetime": s.datetime,
                "side": s.side,
                "entry": s.entry,
                "stop_loss": s.stop_loss,
                "tp1": s.tp1,
                "tp2": s.tp2,
                "tp3": s.tp3,
                "risk_per_unit": s.risk_per_unit,
                "bar_index": s.index,
            }
            for s in signals
        ],
    )
