from pathlib import Path

import polars as pl
import pyarrow as pa
import pyarrow.parquet as pq

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger("storage.parquet")

CANDLE_SCHEMA = pa.schema([
    ("ts", pa.int64()),
    ("open", pa.float64()),
    ("high", pa.float64()),
    ("low", pa.float64()),
    ("close", pa.float64()),
    ("volume", pa.float64()),
])


class ParquetStorage:
    """Local Parquet layout: /data/{exchange}/{symbol}/{timeframe}.parquet"""

    def __init__(self, root: str | None = None) -> None:
        self.root = Path(root or get_settings().data_root)
        self.root.mkdir(parents=True, exist_ok=True)

    def candle_path(self, exchange: str, symbol: str, timeframe: str) -> Path:
        path = self.root / exchange.lower() / symbol.upper() / f"{timeframe}.parquet"
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def write_candles(
        self,
        exchange: str,
        symbol: str,
        timeframe: str,
        df: pl.DataFrame,
        merge: bool = True,
    ) -> Path:
        path = self.candle_path(exchange, symbol, timeframe)
        required = {"ts", "open", "high", "low", "close", "volume"}
        if not required.issubset(set(df.columns)):
            raise ValueError(f"Missing columns. Required: {required}")

        df = df.select(sorted(required)).sort("ts").unique(subset=["ts"], keep="last")

        if merge and path.exists():
            existing = pl.read_parquet(path)
            df = pl.concat([existing, df]).unique(subset=["ts"], keep="last").sort("ts")

        df.write_parquet(path, compression="zstd")
        logger.info("Wrote parquet", extra={"path": str(path), "rows": len(df)})
        return path

    def read_candles_lazy(
        self,
        exchange: str,
        symbol: str,
        timeframe: str,
    ) -> pl.LazyFrame | None:
        path = self.candle_path(exchange, symbol, timeframe)
        if not path.exists():
            return None
        return pl.scan_parquet(path)

    def last_ts(self, exchange: str, symbol: str, timeframe: str) -> int | None:
        lf = self.read_candles_lazy(exchange, symbol, timeframe)
        if lf is None:
            return None
        result = lf.select(pl.col("ts").max()).collect()
        if result.is_empty():
            return None
        val = result.item(0, 0)
        return int(val) if val is not None else None

    def storage_stats(self) -> dict:
        total_bytes = 0
        file_count = 0
        for p in self.root.rglob("*.parquet"):
            total_bytes += p.stat().st_size
            file_count += 1
        return {
            "root": str(self.root),
            "file_count": file_count,
            "total_bytes": total_bytes,
            "total_mb": round(total_bytes / (1024 * 1024), 2),
        }
