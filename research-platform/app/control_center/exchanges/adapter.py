"""Multi-exchange trading adapter — pluggable CCXT futures layer."""

from __future__ import annotations

import time
from abc import ABC, abstractmethod
from typing import Any

from app.core.config import get_settings
from app.core.logging import get_logger
from app.live_trading.execution.leverage import leverage_fallback_chain
from app.live_trading.types import LiveOrderType

logger = get_logger("control_center.exchanges")

SUPPORTED = ("binance", "bybit", "okx", "hyperliquid")


class TradingExchangeAdapter(ABC):
    exchange_id: str = "base"

    def __init__(self) -> None:
        self.settings = get_settings()
        self._client = None
        self.connected = False
        self.dry_run = True
        self.last_latency_ms = 0
        self.error_count = 0
        self.ws_ok = False

    @abstractmethod
    def _credentials(self) -> dict[str, str]:
        ...

    async def connect(self) -> None:
        creds = self._credentials()
        if not creds.get("apiKey"):
            self.dry_run = True
            self.connected = True
            return
        import ccxt.async_support as ccxt

        self._client = self._build_client(ccxt, creds)
        await self._client.load_markets()
        self.connected = True
        self.dry_run = False

    @abstractmethod
    def _build_client(self, ccxt_mod: Any, creds: dict) -> Any:
        ...

    async def close(self) -> None:
        if self._client:
            await self._client.close()
            self._client = None
        self.connected = False

    async def test_connection(self) -> dict[str, Any]:
        t0 = time.perf_counter()
        try:
            if self.dry_run:
                self.last_latency_ms = 1
                return {"ok": True, "dry_run": True, "latency_ms": 1}
            await self._client.fetch_balance()
            self.last_latency_ms = int((time.perf_counter() - t0) * 1000)
            return {"ok": True, "latency_ms": self.last_latency_ms}
        except Exception as e:
            self.error_count += 1
            return {"ok": False, "error": str(e)}

    async def fetch_balance(self) -> dict[str, float]:
        if self.dry_run:
            bal = self.settings.live_default_balance
            return {"total": bal, "free": bal * 0.5, "used": 0.0}
        t0 = time.perf_counter()
        bal = await self._client.fetch_balance()
        self.last_latency_ms = int((time.perf_counter() - t0) * 1000)
        usdt = bal.get("USDT", {})
        if isinstance(usdt, dict):
            return {"total": float(usdt.get("total", 0)), "free": float(usdt.get("free", 0)), "used": float(usdt.get("used", 0))}
        return {"total": 0.0, "free": 0.0, "used": 0.0}

    async def fetch_positions(self) -> list[dict]:
        if self.dry_run:
            return []
        positions = await self._client.fetch_positions()
        return [p for p in positions if float(p.get("contracts") or 0) != 0]

    async def place_order(
        self, symbol: str, direction: str, quantity: float, order_type: LiveOrderType = LiveOrderType.MARKET,
        price: float | None = None, reduce_only: bool = False,
    ) -> dict[str, Any]:
        sym = symbol.replace("/", "")
        side = "buy" if direction.upper() == "LONG" else "sell"
        if self.dry_run:
            from app.paper_trading.market_data.feed import get_market_feed
            fill = price or get_market_feed().get_price(sym) or 100000.0
            return {"id": f"dry_{sym}_{int(time.time())}", "filled": quantity, "average": fill, "dry_run": True}
        params: dict[str, Any] = {"reduceOnly": reduce_only}
        result = await self._client.create_order(sym, "market", side, quantity, None, params)
        return result

    async def set_leverage(self, symbol: str, leverage: int) -> bool:
        if self.dry_run:
            return True
        sym = symbol.replace("/", "")
        for lev in leverage_fallback_chain(leverage):
            try:
                await self._client.set_leverage(lev, sym)
                return True
            except Exception:
                continue
        return False

    def status(self) -> dict[str, Any]:
        return {
            "exchange_id": self.exchange_id,
            "connected": self.connected,
            "dry_run": self.dry_run,
            "ws_ok": self.ws_ok,
            "latency_ms": self.last_latency_ms,
            "error_count": self.error_count,
        }


class BinanceTradingAdapter(TradingExchangeAdapter):
    exchange_id = "binance"

    def _credentials(self) -> dict[str, str]:
        return {"apiKey": self.settings.binance_api_key, "secret": self.settings.binance_api_secret}

    def _build_client(self, ccxt_mod: Any, creds: dict) -> Any:
        opts: dict[str, Any] = {"enableRateLimit": True, "options": {"defaultType": "future"}, **creds}
        if self.settings.binance_testnet:
            opts["options"]["sandboxMode"] = True
        return ccxt_mod.binance(opts)


class BybitTradingAdapter(TradingExchangeAdapter):
    exchange_id = "bybit"

    def _credentials(self) -> dict[str, str]:
        return {"apiKey": self.settings.bybit_api_key, "secret": self.settings.bybit_api_secret}

    def _build_client(self, ccxt_mod: Any, creds: dict) -> Any:
        return ccxt_mod.bybit({"enableRateLimit": True, "options": {"defaultType": "linear"}, **creds})


class OkxTradingAdapter(TradingExchangeAdapter):
    exchange_id = "okx"

    def _credentials(self) -> dict[str, str]:
        return {
            "apiKey": self.settings.okx_api_key,
            "secret": self.settings.okx_api_secret,
            "password": self.settings.okx_passphrase,
        }

    def _build_client(self, ccxt_mod: Any, creds: dict) -> Any:
        return ccxt_mod.okx({"enableRateLimit": True, "options": {"defaultType": "swap"}, **creds})


class HyperliquidTradingAdapter(TradingExchangeAdapter):
    exchange_id = "hyperliquid"

    def _credentials(self) -> dict[str, str]:
        return {"apiKey": self.settings.hyperliquid_api_key, "secret": self.settings.hyperliquid_api_secret}

    def _build_client(self, ccxt_mod: Any, creds: dict) -> Any:
        return ccxt_mod.hyperliquid({"enableRateLimit": True, **creds})


def create_trading_adapter(exchange_id: str) -> TradingExchangeAdapter:
    adapters = {
        "binance": BinanceTradingAdapter,
        "bybit": BybitTradingAdapter,
        "okx": OkxTradingAdapter,
        "hyperliquid": HyperliquidTradingAdapter,
    }
    cls = adapters.get(exchange_id.lower())
    if not cls:
        raise ValueError(f"Unsupported exchange: {exchange_id}")
    return cls()
