import polars as pl
import pytest

from app.indicators.engine import compute_all_indicators


@pytest.fixture
def ohlcv_df() -> pl.DataFrame:
    n = 250
    return pl.DataFrame({
        "ts": [1_700_000_000_000 + i * 900_000 for i in range(n)],
        "open": [100.0 + (i % 10) for i in range(n)],
        "high": [102.0 + (i % 10) for i in range(n)],
        "low": [98.0 + (i % 10) for i in range(n)],
        "close": [101.0 + (i % 10) for i in range(n)],
        "volume": [1000.0 + i for i in range(n)],
    })


def test_compute_all_indicators(ohlcv_df: pl.DataFrame):
    lf = ohlcv_df.lazy()
    result = compute_all_indicators(lf)
    expected_cols = {
        "ts", "open", "high", "low", "close", "volume",
        "ema20", "ema50", "ema100", "ema200",
        "rsi14", "atr14", "macd", "macd_signal", "macd_hist", "vwap",
    }
    assert expected_cols.issubset(set(result.columns))
    assert len(result) == len(ohlcv_df)
    assert result["ema20"].drop_nulls().len() > 0
    assert result["rsi14"].drop_nulls().len() > 0
