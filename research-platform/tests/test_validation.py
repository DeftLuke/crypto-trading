import tempfile
from pathlib import Path

import polars as pl
import pytest

from app.services.validation import DataValidator
from app.storage.parquet_store import ParquetStorage


@pytest.fixture
def temp_data_root(tmp_path: Path) -> Path:
    return tmp_path / "data"


@pytest.fixture
def sample_candles() -> pl.DataFrame:
    base_ts = 1_700_000_000_000
    return pl.DataFrame({
        "ts": [base_ts + i * 900_000 for i in range(100)],
        "open": [100.0 + i * 0.1 for i in range(100)],
        "high": [101.0 + i * 0.1 for i in range(100)],
        "low": [99.0 + i * 0.1 for i in range(100)],
        "close": [100.5 + i * 0.1 for i in range(100)],
        "volume": [1000.0 + i for i in range(100)],
    })


def test_parquet_write_read_merge(temp_data_root: Path, sample_candles: pl.DataFrame):
    store = ParquetStorage(root=str(temp_data_root))
    store.write_candles("binance", "BTCUSDT", "15m", sample_candles, merge=False)
    path = store.candle_path("binance", "BTCUSDT", "15m")
    assert path.exists()

    extra = sample_candles.tail(5).with_columns(pl.col("close") + 1)
    store.write_candles("binance", "BTCUSDT", "15m", extra, merge=True)

    lf = store.read_candles_lazy("binance", "BTCUSDT", "15m")
    assert lf is not None
    df = lf.collect()
    assert len(df) == 100
    assert store.last_ts("binance", "BTCUSDT", "15m") == sample_candles["ts"][-1]


def test_validation_detects_gaps(sample_candles: pl.DataFrame):
    rows = sample_candles.to_dicts()
    del rows[50]
    broken = pl.DataFrame(rows).sort("ts")
    validator = DataValidator()
    report = validator.validate_candles(broken, "binance", "BTCUSDT", "15m")
    assert not report.valid
    assert any("missing_candles" in i for i in report.issues)


def test_validation_detects_duplicates(sample_candles: pl.DataFrame):
    duped = pl.concat([sample_candles, sample_candles.slice(0, 1)])
    validator = DataValidator()
    report = validator.validate_candles(duped, "binance", "BTCUSDT", "15m")
    assert not report.valid
    assert any("duplicate" in i for i in report.issues)


def test_validation_invalid_prices(sample_candles: pl.DataFrame):
    bad = sample_candles.with_columns(pl.when(pl.col("ts") == sample_candles["ts"][0]).then(-1).otherwise(pl.col("open")).alias("open"))
    validator = DataValidator()
    report = validator.validate_candles(bad, "binance", "BTCUSDT", "15m")
    assert not report.valid
