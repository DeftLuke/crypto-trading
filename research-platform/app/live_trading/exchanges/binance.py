"""Exchange connectivity — CCXT Binance Futures with dry-run mode."""

from __future__ import annotations

import time
from typing import Any

from app.core.config import get_settings
from app.core.logging import get_logger
from app.live_trading.execution.leverage import leverage_fallback_chain
from app.live_trading.types import LiveOrder, LiveOrderStatus, LiveOrderType

logger = get_logger("live_trading.exchanges.binance")


class BinanceFuturesExchange:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._client = None
        self.dry_run = self.settings.live_dry_run or not (
            self.settings.binance_api_key and self.settings.binance_api_secret
        )
        self.connected = False
        self.last_latency_ms = 0
        self.error_count = 0

    async def connect(self) -> None:
        if self.dry_run:
            self.connected = True
            logger.info("Live exchange in DRY-RUN mode (no real orders)")
            return
        import ccxt.async_support as ccxt

        opts: dict[str, Any] = {
            "enableRateLimit": True,
            "options": {"defaultType": "future", "adjustForTimeDifference": True},
            "apiKey": self.settings.binance_api_key,
            "secret": self.settings.binance_api_secret,
        }
        if self.settings.binance_testnet:
            opts["options"]["sandboxMode"] = True
        self._client = ccxt.binance(opts)
        await self._client.load_markets()
        self.connected = True

    async def close(self) -> None:
        if self._client:
            await self._client.close()
            self._client = None
        self.connected = False

    async def fetch_balance(self) -> dict[str, float]:
        if self.dry_run:
            return {"total": self.settings.live_default_balance, "free": self.settings.live_default_balance * 0.5, "used": 0.0}
        t0 = time.perf_counter()
        bal = await self._client.fetch_balance()
        self.last_latency_ms = int((time.perf_counter() - t0) * 1000)
        usdt = bal.get("USDT", bal.get("total", {}))
        if isinstance(usdt, dict):
            return {"total": float(usdt.get("total", 0)), "free": float(usdt.get("free", 0)), "used": float(usdt.get("used", 0))}
        return {"total": float(bal.get("total", {}).get("USDT", 0)), "free": 0, "used": 0}

    async def fetch_positions(self) -> list[dict[str, Any]]:
        if self.dry_run:
            return []
        t0 = time.perf_counter()
        positions = await self._client.fetch_positions()
        self.last_latency_ms = int((time.perf_counter() - t0) * 1000)
        return [p for p in positions if float(p.get("contracts") or 0) != 0]

    async def set_leverage(self, symbol: str, leverage: int) -> bool:
        sym = symbol.replace("/", "")
        for lev in leverage_fallback_chain(leverage):
            try:
                if self.dry_run:
                    return True
                await self._client.set_leverage(lev, sym)
                return True
            except Exception as e:
                logger.warning("Leverage rejected, trying fallback", extra={"leverage": lev, "error": str(e)})
        return False

    async def place_order(
        self,
        symbol: str,
        direction: str,
        quantity: float,
        order_type: LiveOrderType = LiveOrderType.MARKET,
        price: float | None = None,
        stop_price: float | None = None,
        reduce_only: bool = False,
    ) -> dict[str, Any]:
        sym = symbol.replace("/", "")
        side = "buy" if direction.upper() == "LONG" else "sell"
        t0 = time.perf_counter()

        if self.dry_run:
            if price:
                fill_price = price
            elif stop_price:
                fill_price = stop_price
            else:
                from app.paper_trading.market_data.feed import get_market_feed

                sym = symbol.replace("/", "")
                fill_price = get_market_feed().get_price(sym) or (100000.0 if "BTC" in sym else 3000.0)
            self.last_latency_ms = int((time.perf_counter() - t0) * 1000) + self.settings.live_simulated_latency_ms
            return {
                "id": f"dry_{int(time.time() * 1000)}",
                "symbol": sym,
                "side": side,
                "price": fill_price,
                "amount": quantity,
                "filled": quantity,
                "status": "closed",
                "dry_run": True,
            }

        params: dict[str, Any] = {"reduceOnly": reduce_only}
        try:
            if order_type == LiveOrderType.MARKET:
                result = await self._client.create_order(sym, "market", side, quantity, None, params)
            elif order_type == LiveOrderType.LIMIT and price:
                result = await self._client.create_order(sym, "limit", side, quantity, price, params)
            elif order_type in (LiveOrderType.STOP_MARKET, LiveOrderType.STOP) and stop_price:
                params["stopPrice"] = stop_price
                result = await self._client.create_order(sym, "stop_market", side, quantity, None, params)
            else:
                result = await self._client.create_order(sym, "market", side, quantity, None, params)
            self.last_latency_ms = int((time.perf_counter() - t0) * 1000)
            self.error_count = 0
            return result
        except Exception as e:
            self.error_count += 1
            self.last_latency_ms = int((time.perf_counter() - t0) * 1000)
            raise RuntimeError(str(e)) from e

    async def cancel_order(self, symbol: str, exchange_order_id: str) -> bool:
        if self.dry_run:
            return True
        await self._client.cancel_order(exchange_order_id, symbol.replace("/", ""))
        return True

    async def fetch_ticker(self, symbol: str) -> float:
        if self.dry_run:
            from app.paper_trading.market_data.feed import get_market_feed

            p = get_market_feed().get_price(symbol)
            if p:
                return p
            return 100000.0 if "BTC" in symbol else 3000.0
        ticker = await self._client.fetch_ticker(symbol.replace("/", ""))
        return float(ticker.get("last") or ticker.get("close") or 0)

    def status(self) -> dict[str, Any]:
        return {
            "connected": self.connected,
            "dry_run": self.dry_run,
            "latency_ms": self.last_latency_ms,
            "error_count": self.error_count,
            "exchange": "binance_futures",
        }
