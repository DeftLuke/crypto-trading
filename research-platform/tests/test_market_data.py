"""Tests for market data archive URLs and paths."""

from __future__ import annotations

from unittest.mock import patch

from app.market_data.archive_downloader import _download_one
from app.market_data.archive_urls import ArchiveMonth, build_archive_plan
from app.market_data.paths import missing_archive_marker_path, month_parquet_path
from app.market_data.symbol_universe import (
    filter_blacklisted,
    get_ranked_futures_universe,
    is_symbol_blacklisted,
)


def test_archive_month_url():
    m = ArchiveMonth("BTCUSDT", "15m", 2025, 1)
    assert m.filename == "BTCUSDT-15m-2025-01.zip"
    assert "data.binance.vision" in m.url
    assert "/futures/um/monthly/klines/BTCUSDT/15m/" in m.url


def test_build_archive_plan():
    plan = build_archive_plan("ETHUSDT", "1h", months_back=3)
    assert len(plan) >= 3
    assert plan[-1].symbol == "ETHUSDT"


def test_month_parquet_path_layout():
    p = month_parquet_path("BTCUSDT", "15m", 2025, 1)
    assert p.name == "01.parquet"
    assert p.parent.name == "2025"
    assert p.parent.parent.name == "15m"
    assert p.parent.parent.parent.name == "BTCUSDT"


def test_ranked_universe_from_mocked_binance():
    fake_info = {
        "symbols": [
            {"symbol": "BTCUSDT", "status": "TRADING", "contractType": "PERPETUAL", "quoteAsset": "USDT"},
            {"symbol": "ETHUSDT", "status": "TRADING", "contractType": "PERPETUAL", "quoteAsset": "USDT"},
            {"symbol": "LOWUSDT", "status": "TRADING", "contractType": "PERPETUAL", "quoteAsset": "USDT"},
        ]
    }
    fake_tickers = [
        {"symbol": "BTCUSDT", "quoteVolume": "9000000000"},
        {"symbol": "ETHUSDT", "quoteVolume": "5000000000"},
        {"symbol": "LOWUSDT", "quoteVolume": "1000"},
    ]

    class FakeResp:
        def raise_for_status(self):
            return self

        def json(self):
            return self._data

    class FakeClient:
        def __init__(self, *args, **kwargs):
            self._step = 0

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def get(self, url):
            resp = FakeResp()
            resp._data = fake_info if "exchangeInfo" in url else fake_tickers
            return resp

    with patch("app.market_data.symbol_universe.httpx.Client", FakeClient):
        ranked = get_ranked_futures_universe(limit=2, min_vol=500000, force_refresh=True)

    assert ranked == ["BTCUSDT", "ETHUSDT"]


def test_build_archive_plan_respects_listing_month():
    plan = build_archive_plan("NEWUSDT", "1d", months_back=12, listing_ym=(2026, 3))
    assert plan
    assert (plan[0].year, plan[0].month) >= (2026, 3)


def test_symbol_blacklist_includes_bsb():
    assert is_symbol_blacklisted("BSBUSDT")
    assert "BSBUSDT" not in filter_blacklisted(["BTCUSDT", "BSBUSDT"])


def test_missing_archive_marker_skips_http(monkeypatch, tmp_path):
    month = ArchiveMonth("BSBUSDT", "1d", 2026, 2)
    marker = missing_archive_marker_path(month.symbol, month.timeframe, month.year, month.month)

    def fail_if_called(*args, **kwargs):
        raise AssertionError("HTTP should not run when missing marker exists")

    monkeypatch.setattr(
        "app.market_data.archive_downloader.month_parquet_path",
        lambda *a, **k: tmp_path / "missing.parquet",
    )
    monkeypatch.setattr(
        "app.market_data.archive_downloader.zip_cache_path",
        lambda *a, **k: tmp_path / "x.zip",
    )
    monkeypatch.setattr(
        "app.market_data.archive_downloader.partial_zip_path",
        lambda *a, **k: tmp_path / "x.zip.part",
    )
    monkeypatch.setattr(
        "app.market_data.archive_downloader.missing_archive_marker_path",
        lambda *a, **k: marker,
    )
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text("404\n", encoding="utf-8")
    monkeypatch.setattr("app.market_data.archive_downloader.httpx.stream", fail_if_called)

    assert _download_one(month) == "missing"
