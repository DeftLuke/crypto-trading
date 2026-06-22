"""Market data manager — read/merge/validate local Parquet; SMC reads through here only."""

from __future__ import annotations

import os
import time
from datetime import UTC, datetime
from pathlib import Path

import polars as pl

from app.core.logging import get_logger
from app.market_data.archive_downloader import HistoricalArchiveDownloader
from app.market_data.archive_urls import ArchiveMonth, build_archive_plan, iter_months
from app.market_data.constants import DEFAULT_LIMITS, MIN_BARS, TIMEFRAME_MS
from app.market_data.converter import convert_all_downloaded, convert_zip_to_parquet
from app.market_data.paths import (
    current_year_month,
    market_data_root,
    month_parquet_path,
    ts_to_year_month,
)
from app.market_data.symbol_universe import get_symbol_listing_ym

logger = get_logger("market_data.manager")


class MarketDataManager:
    """Local Parquet store at {market_data_root}/{symbol}/{timeframe}/{year}/{MM}.parquet"""

    def __init__(self, workers: int = 4) -> None:
        self.downloader = HistoricalArchiveDownloader(workers=workers)
        self.root = market_data_root()

    def list_month_files(self, symbol: str, timeframe: str) -> list[Path]:
        base = self.root / symbol.upper() / timeframe
        if not base.exists():
            return []
        return sorted(base.rglob("*.parquet"))

    def _scan_lazy(self, symbol: str, timeframe: str) -> pl.LazyFrame | None:
        files = self.list_month_files(symbol, timeframe)
        if not files:
            return None
        frames = [pl.scan_parquet(str(p)) for p in files]
        return pl.concat(frames).sort("ts").unique(subset=["ts"], keep="last")

    def load_tail(self, symbol: str, timeframe: str, limit: int = 500) -> pl.DataFrame | None:
        lf = self._scan_lazy(symbol, timeframe)
        if lf is None:
            return None
        df = lf.sort("ts").tail(limit).collect()
        return df if not df.is_empty() else None

    def load_range(
        self,
        symbol: str,
        timeframe: str,
        start_ts: int,
        end_ts: int,
    ) -> pl.DataFrame | None:
        lf = self._scan_lazy(symbol, timeframe)
        if lf is None:
            return None
        df = (
            lf.filter(pl.col("ts") >= start_ts)
            .filter(pl.col("ts") <= end_ts)
            .collect()
            .sort("ts")
        )
        return df if not df.is_empty() else None

    def load_mtf_tail(
        self,
        symbol: str,
        timeframes: list[str],
        limits: dict[str, int] | None = None,
    ) -> dict[str, pl.DataFrame]:
        limits = limits or DEFAULT_LIMITS
        out: dict[str, pl.DataFrame] = {}
        for tf in timeframes:
            limit = limits.get(tf, 300)
            df = self.load_tail(symbol, tf, limit)
            min_need = MIN_BARS.get(tf, max(50, limit // 2))
            if df is not None and len(df) >= min_need:
                out[tf] = df
        return out

    def is_fresh(self, df: pl.DataFrame, timeframe: str) -> bool:
        if df.is_empty():
            return False
        last_ts = int(df["ts"][-1])
        interval = TIMEFRAME_MS.get(timeframe, 900_000)
        return (int(time.time() * 1000) - last_ts) < interval * 3

    def detect_gaps(self, df: pl.DataFrame, timeframe: str) -> list[dict]:
        if df.is_empty() or len(df) < 2:
            return []
        interval = TIMEFRAME_MS.get(timeframe, 900_000)
        ts_list = df["ts"].to_list()
        gaps = []
        for i in range(1, len(ts_list)):
            delta = ts_list[i] - ts_list[i - 1]
            if delta > interval * 1.5:
                gaps.append({
                    "from_ts": ts_list[i - 1],
                    "to_ts": ts_list[i],
                    "missing_bars": int(delta / interval) - 1,
                })
        return gaps

    def validate_continuity(self, symbol: str, timeframe: str, limit: int = 500) -> dict:
        df = self.load_tail(symbol, timeframe, limit)
        if df is None or df.is_empty():
            return {"ok": False, "bars": 0, "gaps": [], "fresh": False}
        gaps = self.detect_gaps(df, timeframe)
        return {
            "ok": len(gaps) == 0 and self.is_fresh(df, timeframe),
            "bars": len(df),
            "last_ts": int(df["ts"][-1]),
            "fresh": self.is_fresh(df, timeframe),
            "gaps": gaps[:10],
        }

    def _is_ready(self, df: pl.DataFrame, timeframe: str, min_bars: int) -> bool:
        if df is None or df.is_empty() or len(df) < min_bars:
            return False
        require_fresh = os.getenv("MARKET_DATA_REQUIRE_FRESH", "false").lower() == "true"
        return self.is_fresh(df, timeframe) if require_fresh else True

    def status(self, symbol: str, timeframe: str) -> dict:
        min_bars = MIN_BARS.get(timeframe, 100)
        df = self.load_tail(symbol, timeframe, min_bars + 20)
        files = self.list_month_files(symbol, timeframe)
        if df is None or df.is_empty():
            return {
                "symbol": symbol.upper(),
                "timeframe": timeframe,
                "ready": False,
                "bars": 0,
                "min_bars": min_bars,
                "fresh": False,
                "month_files": len(files),
            }
        return {
            "symbol": symbol.upper(),
            "timeframe": timeframe,
            "ready": self._is_ready(df, timeframe, min_bars),
            "bars": len(df),
            "min_bars": min_bars,
            "fresh": self.is_fresh(df, timeframe),
            "last_ts": int(df["ts"][-1]),
            "month_files": len(files),
        }

    def mtf_status(self, symbol: str, timeframes: list[str]) -> dict:
        by_tf = {tf: self.status(symbol, tf) for tf in timeframes}
        ready = all(v.get("ready") for v in by_tf.values())
        return {"symbol": symbol.upper(), "ready": ready, "timeframes": by_tf}

    def append_bar(
        self,
        symbol: str,
        timeframe: str,
        *,
        ts: int,
        open: float,
        high: float,
        low: float,
        close: float,
        volume: float,
    ) -> Path:
        """Append one closed candle to current month Parquet (live WS path)."""
        year, month = ts_to_year_month(ts)
        path = month_parquet_path(symbol, timeframe, year, month)
        row = pl.DataFrame({
            "ts": [int(ts)],
            "open": [float(open)],
            "high": [float(high)],
            "low": [float(low)],
            "close": [float(close)],
            "volume": [float(volume)],
        })
        if path.exists():
            existing = pl.read_parquet(path)
            merged = pl.concat([existing, row]).unique(subset=["ts"], keep="last").sort("ts")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            merged = row
        merged.write_parquet(path, compression="zstd")
        return path

    def ingest_archives(
        self,
        symbol: str,
        timeframe: str,
        *,
        months_back: int | None = None,
        min_bars: int | None = None,
        force: bool = False,
    ) -> dict:
        """Download ZIPs from Binance Vision → convert to monthly Parquet."""
        listing_ym = get_symbol_listing_ym(symbol)
        plan = build_archive_plan(
            symbol,
            timeframe,
            months_back=months_back,
            min_bars=min_bars or MIN_BARS.get(timeframe, 200),
            listing_ym=listing_ym,
        )
        dl = self.downloader.download_months(plan, force=force)
        converted = convert_all_downloaded(plan, delete_zip=True)
        st = self.status(symbol, timeframe)
        return {
            "symbol": symbol.upper(),
            "timeframe": timeframe,
            "listing_ym": listing_ym,
            "download": {
                "total": dl.total,
                "completed": dl.completed,
                "skipped": dl.skipped,
                "missing": dl.missing,
                "failed": dl.failed,
                "pct": dl.pct,
                "errors": dl.errors[:5],
            },
            "converted": converted,
            "status": st,
        }

    def ensure_timeframes(
        self,
        symbol: str,
        timeframes: list[str],
        *,
        months_back: int | None = None,
    ) -> dict[str, dict]:
        results = {}
        for tf in timeframes:
            st = self.status(symbol, tf)
            if st.get("ready"):
                results[tf] = {"action": "ok", "status": st}
                continue
            results[tf] = {
                "action": "ingest",
                **self.ingest_archives(symbol, tf, months_back=months_back),
            }
        return results

    def storage_stats(self) -> dict:
        total_bytes = 0
        file_count = 0
        for p in self.root.rglob("*.parquet"):
            if "_cache" in p.parts:
                continue
            total_bytes += p.stat().st_size
            file_count += 1
        return {
            "root": str(self.root),
            "parquet_files": file_count,
            "total_bytes": total_bytes,
            "total_mb": round(total_bytes / (1024 * 1024), 2),
        }
