from abc import ABC, abstractmethod
from typing import Any

import ccxt.async_support as ccxt_async

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger("services.exchange")

TIMEFRAME_MS = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "1h": 3_600_000,
    "4h": 14_400_000,
    "1d": 86_400_000,
}

SUPPORTED_EXCHANGES = ("binance", "bybit", "okx", "hyperliquid")


class ExchangeAdapter(ABC):
    def __init__(self, exchange_id: str) -> None:
        self.exchange_id = exchange_id
        self._client: Any = None

    @abstractmethod
    def _build_client(self) -> Any:
        ...

    async def connect(self) -> None:
        self._client = self._build_client()
        await self._client.load_markets()

    async def close(self) -> None:
        if self._client:
            await self._client.close()
            self._client = None

    async def fetch_ohlcv(
        self,
        symbol: str,
        timeframe: str,
        since: int | None = None,
        limit: int = 1000,
    ) -> list[list[float]]:
        if not self._client:
            await self.connect()
        return await self._client.fetch_ohlcv(symbol, timeframe, since=since, limit=limit)

    async def fetch_funding_rate_history(
        self,
        symbol: str,
        since: int | None = None,
        limit: int = 100,
    ) -> list[dict]:
        if not self._client:
            await self.connect()
        if not self._client.has.get("fetchFundingRateHistory"):
            return []
        return await self._client.fetch_funding_rate_history(symbol, since=since, limit=limit)

    async def fetch_open_interest_history(
        self,
        symbol: str,
        timeframe: str = "1h",
        since: int | None = None,
        limit: int = 100,
    ) -> list[dict]:
        if not self._client:
            await self.connect()
        if not self._client.has.get("fetchOpenInterestHistory"):
            return []
        return await self._client.fetch_open_interest_history(
            symbol, timeframe, since=since, limit=limit
        )


class BinanceAdapter(ExchangeAdapter):
    def _build_client(self) -> Any:
        s = get_settings()
        opts: dict = {"enableRateLimit": True, "options": {"defaultType": "future"}}
        if s.binance_api_key:
            opts["apiKey"] = s.binance_api_key
            opts["secret"] = s.binance_api_secret
        return ccxt_async.binance(opts)


class BybitAdapter(ExchangeAdapter):
    def _build_client(self) -> Any:
        s = get_settings()
        opts: dict = {"enableRateLimit": True, "options": {"defaultType": "linear"}}
        if s.bybit_api_key:
            opts["apiKey"] = s.bybit_api_key
            opts["secret"] = s.bybit_api_secret
        return ccxt_async.bybit(opts)


class OkxAdapter(ExchangeAdapter):
    def _build_client(self) -> Any:
        s = get_settings()
        opts: dict = {"enableRateLimit": True, "options": {"defaultType": "swap"}}
        if s.okx_api_key:
            opts["apiKey"] = s.okx_api_key
            opts["secret"] = s.okx_api_secret
            opts["password"] = s.okx_passphrase
        return ccxt_async.okx(opts)


class HyperliquidAdapter(ExchangeAdapter):
    def _build_client(self) -> Any:
        return ccxt_async.hyperliquid({"enableRateLimit": True})


def get_exchange_adapter(exchange_id: str) -> ExchangeAdapter:
    mapping: dict[str, type[ExchangeAdapter]] = {
        "binance": BinanceAdapter,
        "bybit": BybitAdapter,
        "okx": OkxAdapter,
        "hyperliquid": HyperliquidAdapter,
    }
    key = exchange_id.lower()
    if key not in mapping:
        raise ValueError(f"Unsupported exchange: {exchange_id}. Supported: {SUPPORTED_EXCHANGES}")
    return mapping[key](key)
