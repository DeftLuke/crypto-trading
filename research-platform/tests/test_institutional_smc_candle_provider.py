"""Tests for store-first candle provider (local Parquet manager)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import polars as pl
import pytest

from app.institutional_smc.data.candle_provider import fetch_mtf_candles


def _make_df(n: int = 200) -> pl.DataFrame:
    base = 1_700_000_000_000
    return pl.DataFrame({
        "ts": [base + i * 86_400_000 for i in range(n)],
        "open": [100.0] * n,
        "high": [101.0] * n,
        "low": [99.0] * n,
        "close": [100.5] * n,
        "volume": [1000.0] * n,
    })


@pytest.mark.asyncio
async def test_fetch_mtf_from_manager():
    mock_mgr = MagicMock()
    mock_mgr.load_mtf_tail.return_value = {"1d": _make_df(200)}

    with patch("app.institutional_smc.data.candle_provider._manager", mock_mgr):
        out = await fetch_mtf_candles("binance", "BTCUSDT", ["1d"])
    assert "1d" in out
    mock_mgr.load_mtf_tail.assert_called_once()


@pytest.mark.asyncio
async def test_fetch_mtf_empty_when_no_data():
    mock_mgr = MagicMock()
    mock_mgr.load_mtf_tail.return_value = {}

    with patch("app.institutional_smc.data.candle_provider._manager", mock_mgr):
        out = await fetch_mtf_candles("binance", "ETHUSDT", ["1d", "4h"])
    assert out == {}
