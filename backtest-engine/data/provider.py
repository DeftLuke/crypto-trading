"""
Candle data provider — reuses existing research-platform Parquet cache.

DO NOT download from exchanges here. Use:
  research-platform POST /sync/start
  research-platform POST /sync/batch
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

import pandas as pd

logger = logging.getLogger(__name__)

# Resolve research-platform data root
REPO_ROOT = Path(__file__).resolve().parents[2]
RESEARCH_ROOT = REPO_ROOT / "research-platform"
DATA_ROOT = Path(os.environ.get("RESEARCH_DATA_ROOT", RESEARCH_ROOT / "data"))
LOCAL_CSV_DIR = Path(__file__).resolve().parent


def parquet_path(exchange: str, symbol: str, timeframe: str) -> Path:
    return DATA_ROOT / exchange.lower() / symbol.upper() / f"{timeframe}.parquet"


def csv_path(symbol: str, timeframe: str) -> Path:
    return LOCAL_CSV_DIR / f"{symbol}_{timeframe}.csv"


def load_candles(
    symbol: str,
    timeframe: str,
    exchange: str = "binance",
    start_ts: int | None = None,
    end_ts: int | None = None,
) -> pd.DataFrame | None:
    """
    Load OHLCV from Parquet (SyncEngine output) or legacy local CSV.
    Never calls CCXT.
    """
    pq = parquet_path(exchange, symbol, timeframe)
    if pq.exists():
        try:
            import polars as pl
            lf = pl.scan_parquet(pq)
            if start_ts:
                lf = lf.filter(pl.col("ts") >= start_ts)
            if end_ts:
                lf = lf.filter(pl.col("ts") <= end_ts)
            df = lf.collect().sort("ts")
            if df.is_empty():
                return None
            out = df.to_pandas()
            out["datetime"] = pd.to_datetime(out["ts"], unit="ms", utc=True)
            logger.info("Loaded %d bars from parquet %s", len(out), pq.name)
            return out
        except Exception as exc:
            logger.warning("Parquet read failed: %s", exc)

    csv = csv_path(symbol, timeframe)
    if csv.exists():
        out = pd.read_csv(csv, parse_dates=["datetime"])
        if start_ts:
            out = out[out["timestamp"] >= start_ts]
        if end_ts:
            out = out[out["timestamp"] <= end_ts]
        logger.info("Loaded %d bars from legacy CSV %s", len(out), csv.name)
        return out

    logger.error(
        "No data for %s %s — run research-platform sync first: POST /sync/start",
        symbol,
        timeframe,
    )
    return None


def load_all_timeframes(symbol: str, timeframes: list[str], exchange: str = "binance") -> dict[str, pd.DataFrame]:
    out: dict[str, pd.DataFrame] = {}
    for tf in timeframes:
        df = load_candles(symbol, tf, exchange)
        if df is not None:
            out[tf] = df
    return out
