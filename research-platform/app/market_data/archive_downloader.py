"""Download Binance Vision ZIP archives — resume, skip, verify, parallel."""

from __future__ import annotations

import hashlib
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Callable

from pathlib import Path

import httpx

from app.core.logging import get_logger
from app.market_data.archive_urls import ArchiveMonth
from app.market_data.paths import (
    missing_archive_marker_path,
    month_parquet_path,
    partial_zip_path,
    zip_cache_path,
)

logger = get_logger("market_data.downloader")

DEFAULT_WORKERS = 4
CHUNK_SIZE = 1024 * 256


@dataclass
class DownloadProgress:
    total: int = 0
    completed: int = 0
    skipped: int = 0
    missing: int = 0
    failed: int = 0
    errors: list[str] = field(default_factory=list)

    @property
    def pct(self) -> float:
        if self.total <= 0:
            return 100.0
        return round((self.completed + self.skipped + self.missing) / self.total * 100, 1)


def _file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(CHUNK_SIZE), b""):
            h.update(chunk)
    return h.hexdigest()


def _verify_zip(path: Path) -> bool:
    if not path.exists() or path.stat().st_size < 100:
        return False
    if not zipfile.is_zipfile(path):
        return False
    try:
        with zipfile.ZipFile(path, "r") as zf:
            bad = zf.testzip()
            return bad is None
    except Exception:
        return False


def _download_one(month: ArchiveMonth, *, force: bool = False, timeout: float = 120.0) -> str:
    """Download single month archive. Returns status: ok|skipped|missing|error:..."""
    parquet = month_parquet_path(month.symbol, month.timeframe, month.year, month.month)
    if parquet.exists() and not force:
        return "skipped"

    dest = zip_cache_path(month.symbol, month.timeframe, month.year, month.month)
    partial = partial_zip_path(month.symbol, month.timeframe, month.year, month.month)
    missing_marker = missing_archive_marker_path(
        month.symbol, month.timeframe, month.year, month.month
    )

    if missing_marker.exists() and not force:
        return "missing"

    if dest.exists() and _verify_zip(dest) and not force:
        return "ok"

    headers: dict[str, str] = {}
    mode = "wb"
    start_byte = 0
    if partial.exists():
        start_byte = partial.stat().st_size
        headers["Range"] = f"bytes={start_byte}-"
        mode = "ab"

    try:
        with httpx.stream("GET", month.url, headers=headers, timeout=timeout, follow_redirects=True) as resp:
            if resp.status_code == 404:
                partial.unlink(missing_ok=True)
                missing_marker.parent.mkdir(parents=True, exist_ok=True)
                missing_marker.write_text("404\n", encoding="utf-8")
                return "missing"
            if resp.status_code not in (200, 206):
                return f"error:HTTP {resp.status_code}"
            if resp.status_code == 200 and start_byte > 0:
                partial.unlink(missing_ok=True)
                start_byte = 0
                mode = "wb"

            with partial.open(mode) as f:
                for chunk in resp.iter_bytes(CHUNK_SIZE):
                    f.write(chunk)

        if not _verify_zip(partial):
            partial.unlink(missing_ok=True)
            return "error:invalid zip"

        partial.replace(dest)
        return "ok"
    except Exception as exc:
        logger.warning("Archive download failed %s: %s", month.url, exc)
        return f"error:{exc}"


class HistoricalArchiveDownloader:
    """Multi-threaded Binance Vision archive downloader."""

    def __init__(self, workers: int = DEFAULT_WORKERS) -> None:
        self.workers = max(1, workers)

    def download_months(
        self,
        months: list[ArchiveMonth],
        *,
        force: bool = False,
        on_progress: Callable | None = None,
    ) -> DownloadProgress:
        progress = DownloadProgress(total=len(months))

        if not months:
            return progress

        with ThreadPoolExecutor(max_workers=self.workers) as pool:
            futures = {pool.submit(_download_one, m, force=force): m for m in months}
            for fut in as_completed(futures):
                month = futures[fut]
                status = fut.result()
                if status == "ok":
                    progress.completed += 1
                elif status == "skipped":
                    progress.skipped += 1
                elif status == "missing":
                    progress.missing += 1
                    progress.skipped += 1
                elif status.startswith("error"):
                    progress.failed += 1
                    progress.errors.append(f"{month.filename}: {status}")
                if on_progress:
                    on_progress(progress, month, status)

        return progress
