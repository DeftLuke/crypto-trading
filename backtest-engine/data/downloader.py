"""
DEPRECATED — use data/provider.py (Parquet from research-platform SyncEngine).

This module remains for backward compatibility only. It will NOT call CCXT
if parquet or CSV data already exists.
"""

from __future__ import annotations

import logging

from config.settings import Settings
from data.provider import load_candles

logger = logging.getLogger(__name__)

__all__ = ["download_ohlcv", "load_all_data"]


def download_ohlcv(
    settings: Settings,
    symbol: str,
    timeframe: str,
    force: bool = False,
) -> "pd.DataFrame":
    """Load from shared storage — does not download unless you use research-platform sync."""
    import pandas as pd
    from data.processor import prepare_ohlcv

    if force:
        logger.warning(
            "force=True ignored — use research-platform POST /sync/start with full=true to refresh data"
        )
    df = load_candles(symbol, timeframe, exchange=settings.exchange_id.replace("usdm", ""))
    if df is None:
        raise FileNotFoundError(
            f"No cached data for {symbol} {timeframe}. "
            "Run: curl -X POST research-platform/sync/start with exchange=binance"
        )
    return prepare_ohlcv(df)


def load_all_data(settings: Settings, force: bool = False) -> dict:
    from data.processor import prepare_ohlcv

    store: dict = {}
    for symbol in settings.symbols:
        store[symbol] = {}
        for tf in settings.timeframes:
            raw = download_ohlcv(settings, symbol, tf, force=force)
            store[symbol][tf] = prepare_ohlcv(raw)
    return store
