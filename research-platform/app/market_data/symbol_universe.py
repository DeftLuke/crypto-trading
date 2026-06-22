"""Ranked Binance USDT perpetual futures universe (24h quote volume)."""

from __future__ import annotations

import os
import time
from datetime import UTC, datetime
from typing import Any

import httpx

from app.core.logging import get_logger
from app.market_data.constants import DEFAULT_SYMBOL_BLACKLIST
from app.strategies.e5_institutional.constants import TOP_FUTURES_USDT

logger = get_logger("market_data.universe")

BINANCE_FAPI = "https://fapi.binance.com"
_CACHE: dict[str, Any] = {"symbols": None, "fetched_at": 0.0}
_ONBOARD_MS: dict[str, int] | None = None

def universe_size() -> int:
    return int(os.getenv("MARKET_DATA_UNIVERSE_SIZE", "200"))


def min_quote_volume() -> float:
    return float(os.getenv("MARKET_DATA_MIN_QUOTE_VOLUME", "500000"))


def cache_ttl_seconds() -> int:
    return int(os.getenv("MARKET_DATA_UNIVERSE_CACHE_SEC", "3600"))


def symbol_blacklist() -> set[str]:
    extra = os.getenv("MARKET_DATA_SYMBOL_BLACKLIST", "")
    blocked = {s.strip().upper() for s in extra.split(",") if s.strip()}
    blocked.update(DEFAULT_SYMBOL_BLACKLIST)
    return blocked


def filter_blacklisted(symbols: list[str]) -> list[str]:
    blocked = symbol_blacklist()
    if not blocked:
        return symbols
    return [s for s in symbols if s.upper() not in blocked]


def is_symbol_blacklisted(symbol: str) -> bool:
    return symbol.upper() in symbol_blacklist()


def _ensure_onboard_map() -> dict[str, int]:
    global _ONBOARD_MS
    if _ONBOARD_MS is not None:
        return _ONBOARD_MS
    onboard: dict[str, int] = {}
    try:
        with httpx.Client(timeout=60.0) as client:
            info = client.get(f"{BINANCE_FAPI}/fapi/v1/exchangeInfo").raise_for_status().json()
        for row in info.get("symbols") or []:
            sym = str(row.get("symbol") or "").upper()
            raw = row.get("onboardDate")
            if sym and raw:
                onboard[sym] = int(raw)
    except Exception as exc:
        logger.warning("Failed to load symbol onboard dates: %s", exc)
    _ONBOARD_MS = onboard
    return onboard


def get_symbol_listing_ym(symbol: str) -> tuple[int, int] | None:
    """First UTC year/month the symbol was listed on Binance futures."""
    sym = symbol.upper()
    onboard_ms = _ensure_onboard_map().get(sym)
    if not onboard_ms:
        return None
    dt = datetime.fromtimestamp(onboard_ms / 1000, tz=UTC)
    return dt.year, dt.month


def trading_api_url() -> str:
    return os.getenv("TRADING_API_URL", "http://127.0.0.1:3002").rstrip("/")


def _fetch_ranked_from_binance(*, limit: int, min_vol: float) -> list[str]:
    with httpx.Client(timeout=60.0) as client:
        info = client.get(f"{BINANCE_FAPI}/fapi/v1/exchangeInfo").raise_for_status().json()
        tickers = client.get(f"{BINANCE_FAPI}/fapi/v1/ticker/24hr").raise_for_status().json()

    volume_map: dict[str, float] = {}
    for row in tickers:
        sym = str(row.get("symbol") or "")
        if sym:
            volume_map[sym] = float(row.get("quoteVolume") or 0)

    eligible: set[str] = set()
    for s in info.get("symbols") or []:
        sym = str(s.get("symbol") or "")
        if (
            s.get("status") == "TRADING"
            and s.get("contractType") == "PERPETUAL"
            and s.get("quoteAsset") == "USDT"
            and "_" not in sym
            and volume_map.get(sym, 0) >= min_vol
        ):
            eligible.add(sym)

    ranked = sorted(eligible, key=lambda sym: volume_map.get(sym, 0), reverse=True)
    return filter_blacklisted(ranked[:limit])


def _fetch_ranked_from_trading_api(*, limit: int) -> list[str]:
    """Backend already ranks Binance USDT perpetuals by 24h quote volume."""
    url = f"{trading_api_url()}/api/pairs?all=true"
    with httpx.Client(timeout=60.0) as client:
        resp = client.get(url)
        resp.raise_for_status()
        data = resp.json()
    if not isinstance(data, list):
        return []
    return filter_blacklisted([str(s).upper() for s in data[:limit] if s])


def get_ranked_futures_universe(
    limit: int | None = None,
    min_vol: float | None = None,
    *,
    force_refresh: bool = False,
) -> list[str]:
    """Top USDT perpetuals by 24h quote volume (matches backend scanner ranking)."""
    limit = max(1, limit or universe_size())
    min_vol = min_vol if min_vol is not None else min_quote_volume()
    now = time.time()
    ttl = cache_ttl_seconds()

    if (
        not force_refresh
        and _CACHE["symbols"]
        and now - float(_CACHE["fetched_at"]) < ttl
        and len(_CACHE["symbols"]) >= min(limit, len(_CACHE["symbols"]))
    ):
        return filter_blacklisted(list(_CACHE["symbols"][:limit]))

    try:
        ranked = _fetch_ranked_from_binance(limit=limit, min_vol=min_vol)
        if ranked:
            _CACHE["symbols"] = ranked
            _CACHE["fetched_at"] = now
            logger.info("Ranked futures universe: %d symbols (min vol %.0f)", len(ranked), min_vol)
            return ranked
    except Exception as exc:
        logger.warning("Binance universe fetch failed: %s", exc)

    try:
        ranked = _fetch_ranked_from_trading_api(limit=limit)
        if ranked:
            _CACHE["symbols"] = ranked
            _CACHE["fetched_at"] = now
            logger.info("Ranked futures universe via trading API: %d symbols", len(ranked))
            return ranked
    except Exception as exc:
        logger.warning("Trading API universe fallback failed: %s", exc)

    if _CACHE["symbols"]:
        return filter_blacklisted(list(_CACHE["symbols"][:limit]))

    fallback = list(TOP_FUTURES_USDT)
    if len(fallback) < limit:
        logger.warning(
            "Using static fallback (%d symbols); Binance fetch unavailable for target %d",
            len(fallback),
            limit,
        )
    return filter_blacklisted(fallback[:limit])
