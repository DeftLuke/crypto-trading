"""Convert Binance Vision ZIP/CSV to monthly Parquet files."""

from __future__ import annotations

import zipfile
from io import BytesIO
from pathlib import Path

import polars as pl

from app.core.logging import get_logger
from app.market_data.archive_urls import ArchiveMonth
from app.market_data.paths import month_parquet_path, zip_cache_path

logger = get_logger("market_data.converter")

CSV_COLUMNS = [
    "open_time",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "close_time",
    "quote_volume",
    "trades",
    "taker_buy_base",
    "taker_buy_quote",
    "ignore",
]


def _csv_to_df(raw: bytes) -> pl.DataFrame:
    df = pl.read_csv(BytesIO(raw), has_header=True, infer_schema_length=1000)
    cols = {c.lower(): c for c in df.columns}
    open_time = cols.get("open_time") or cols.get("open time") or df.columns[0]
    return (
        df.select(
            pl.col(open_time).cast(pl.Int64).alias("ts"),
            pl.col(cols.get("open", df.columns[1])).cast(pl.Float64).alias("open"),
            pl.col(cols.get("high", df.columns[2])).cast(pl.Float64).alias("high"),
            pl.col(cols.get("low", df.columns[3])).cast(pl.Float64).alias("low"),
            pl.col(cols.get("close", df.columns[4])).cast(pl.Float64).alias("close"),
            pl.col(cols.get("volume", df.columns[5])).cast(pl.Float64).alias("volume"),
        )
        .sort("ts")
        .unique(subset=["ts"], keep="last")
    )


def convert_zip_to_parquet(month: ArchiveMonth, *, delete_zip: bool = False) -> Path | None:
    """Extract ZIP → monthly Parquet. Returns path or None if zip missing."""
    out = month_parquet_path(month.symbol, month.timeframe, month.year, month.month)
    if out.exists():
        return out

    zpath = zip_cache_path(month.symbol, month.timeframe, month.year, month.month)
    if not zpath.exists():
        return None

    with zipfile.ZipFile(zpath, "r") as zf:
        csv_names = [n for n in zf.namelist() if n.endswith(".csv")]
        if not csv_names:
            raise ValueError(f"No CSV in {zpath}")
        raw = zf.read(csv_names[0])

    df = _csv_to_df(raw)
    if df.is_empty():
        return None

    out.parent.mkdir(parents=True, exist_ok=True)
    df.write_parquet(out, compression="zstd")
    logger.info("Wrote parquet %s rows=%d", out, len(df))

    if delete_zip:
        zpath.unlink(missing_ok=True)
    return out


def convert_all_downloaded(months: list[ArchiveMonth], *, delete_zip: bool = False) -> int:
    written = 0
    for month in months:
        try:
            path = convert_zip_to_parquet(month, delete_zip=delete_zip)
            if path:
                written += 1
        except Exception as exc:
            logger.warning("Convert failed %s: %s", month.filename, exc)
    return written
