"""OHLCV cleaning and validation."""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

REQUIRED_COLUMNS = ["timestamp", "open", "high", "low", "close", "volume", "datetime"]


def validate_candles(df: pd.DataFrame) -> pd.DataFrame:
    """Ensure OHLC integrity and remove invalid rows."""
    if df.empty:
        raise ValueError("Empty OHLCV dataframe")

    missing = set(REQUIRED_COLUMNS) - set(df.columns)
    if missing:
        raise ValueError(f"Missing columns: {missing}")

    work = df.copy()
    for col in ("open", "high", "low", "close", "volume"):
        work[col] = pd.to_numeric(work[col], errors="coerce")

    # OHLC rules
    valid = (
        (work["high"] >= work["low"])
        & (work["high"] >= work["open"])
        & (work["high"] >= work["close"])
        & (work["low"] <= work["open"])
        & (work["low"] <= work["close"])
        & (work["volume"] >= 0)
    )
    invalid_count = (~valid).sum()
    if invalid_count:
        logger.warning("Dropped %d invalid candles", invalid_count)
        work = work.loc[valid]

    work = work.dropna(subset=["open", "high", "low", "close"])
    work = work.sort_values("timestamp").reset_index(drop=True)
    return work


def fill_missing(df: pd.DataFrame) -> pd.DataFrame:
    """Forward-fill small gaps; drop duplicate timestamps."""
    work = df.drop_duplicates(subset=["timestamp"], keep="last").copy()
    work = work.sort_values("timestamp").reset_index(drop=True)
    work[["open", "high", "low", "close", "volume"]] = work[
        ["open", "high", "low", "close", "volume"]
    ].ffill()
    return work


def prepare_ohlcv(df: pd.DataFrame) -> pd.DataFrame:
    """Full pipeline: datetime, clean, validate."""
    work = df.copy()
    if "datetime" not in work.columns:
        work["datetime"] = pd.to_datetime(work["timestamp"], unit="ms", utc=True)
    else:
        work["datetime"] = pd.to_datetime(work["datetime"], utc=True)

    work = fill_missing(work)
    work = validate_candles(work)
    return work


def merge_htf_onto_ltf(ltf: pd.DataFrame, htf: pd.DataFrame, suffix: str = "_htf") -> pd.DataFrame:
    """Align higher-timeframe columns onto lower timeframe (forward fill)."""
    htf_cols = [c for c in htf.columns if c not in ("timestamp", "datetime")]
    htf_renamed = htf[["datetime", *htf_cols]].rename(
        columns={c: f"{c}{suffix}" for c in htf_cols},
    )
    merged = pd.merge_asof(
        ltf.sort_values("datetime"),
        htf_renamed.sort_values("datetime"),
        on="datetime",
        direction="backward",
    )
    return merged.reset_index(drop=True)
