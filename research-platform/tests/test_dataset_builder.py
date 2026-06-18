import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import polars as pl
import pytest

from app.services.dataset_builder import DatasetBuilder


@pytest.fixture
def sample_candles() -> pl.DataFrame:
    n = 50
    return pl.DataFrame({
        "ts": [1_700_000_000_000 + i * 900_000 for i in range(n)],
        "open": [100.0] * n,
        "high": [101.0] * n,
        "low": [99.0] * n,
        "close": [100.5] * n,
        "volume": [1000.0] * n,
    })


@pytest.mark.asyncio
async def test_dataset_builder(tmp_path: Path, sample_candles: pl.DataFrame, monkeypatch):
    monkeypatch.setenv("DATA_ROOT", str(tmp_path))
    from app.core.config import get_settings

    get_settings.cache_clear()

    store_path = tmp_path / "binance" / "BTCUSDT" / "15m.parquet"
    store_path.parent.mkdir(parents=True)
    sample_candles.write_parquet(store_path)

    session = AsyncMock()
    session.add = MagicMock()
    session.flush = AsyncMock()

    execute_result = MagicMock()
    execute_result.all.return_value = []
    session.execute = AsyncMock(return_value=execute_result)

    builder = DatasetBuilder(session)
    ds = await builder.build("binance", "BTCUSDT", "15m", name="test_ds")

    assert ds.status == "completed"
    assert ds.row_count == len(sample_candles)
    assert Path(ds.parquet_path).exists()

    get_settings.cache_clear()
