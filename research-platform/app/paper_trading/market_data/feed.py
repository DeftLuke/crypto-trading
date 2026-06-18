"""Real-time market price feed — Binance Futures WebSocket primary."""

from __future__ import annotations

import asyncio
import json
from typing import Callable

from app.core.logging import get_logger

logger = get_logger("paper_trading.market_feed")

BINANCE_WS = "wss://fstream.binance.com/ws"


class MarketPriceFeed:
    def __init__(self) -> None:
        self.prices: dict[str, float] = {}
        self.mark_prices: dict[str, float] = {}
        self._running = False
        self._task: asyncio.Task | None = None
        self._subscribers: list[Callable[[str, float], None]] = []
        self._symbols: set[str] = {"BTCUSDT", "ETHUSDT", "SOLUSDT"}

    def subscribe(self, callback: Callable[[str, float], None]) -> None:
        self._subscribers.append(callback)

    def add_symbol(self, symbol: str) -> None:
        self._symbols.add(symbol.upper())

    def get_price(self, symbol: str) -> float | None:
        sym = symbol.upper()
        return self.mark_prices.get(sym) or self.prices.get(sym)

    def set_price(self, symbol: str, price: float) -> None:
        sym = symbol.upper()
        self.prices[sym] = price
        self.mark_prices[sym] = price
        for cb in self._subscribers:
            try:
                cb(sym, price)
            except Exception:
                pass

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _run(self) -> None:
        while self._running:
            try:
                await self._connect_streams()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning("Market feed reconnect", extra={"error": str(e)})
                await asyncio.sleep(3)

    async def _connect_streams(self) -> None:
        try:
            import websockets
        except ImportError:
            logger.warning("websockets not installed — using REST fallback")
            await self._rest_fallback_loop()
            return

        streams = "/".join(f"{s.lower()}@markPrice@1s" for s in self._symbols)
        url = f"{BINANCE_WS}/{streams}" if len(self._symbols) == 1 else f"wss://fstream.binance.com/stream?streams={'/'.join(f'{s.lower()}@markPrice@1s' for s in self._symbols)}"

        async with websockets.connect(url, ping_interval=20) as ws:
            logger.info("Paper market feed connected", extra={"symbols": list(self._symbols)})
            async for raw in ws:
                if not self._running:
                    break
                try:
                    msg = json.loads(raw)
                    data = msg.get("data", msg)
                    sym = data.get("s", "").upper()
                    price = float(data.get("p", 0))
                    if sym and price:
                        self.mark_prices[sym] = price
                        self.prices[sym] = price
                        for cb in self._subscribers:
                            try:
                                cb(sym, price)
                            except Exception:
                                pass
                except (json.JSONDecodeError, ValueError, KeyError):
                    continue

    async def _rest_fallback_loop(self) -> None:
        import ccxt.async_support as ccxt

        exchange = ccxt.binance({"enableRateLimit": True, "options": {"defaultType": "future"}})
        try:
            while self._running:
                for sym in list(self._symbols):
                    try:
                        ticker = await exchange.fetch_ticker(sym)
                        price = float(ticker.get("last") or ticker.get("close") or 0)
                        if price:
                            self.prices[sym] = price
                            self.mark_prices[sym] = price
                            for cb in self._subscribers:
                                cb(sym, price)
                    except Exception:
                        pass
                await asyncio.sleep(2)
        finally:
            await exchange.close()

    @property
    def healthy(self) -> bool:
        return self._running and len(self.prices) > 0


_feed: MarketPriceFeed | None = None


def get_market_feed() -> MarketPriceFeed:
    global _feed
    if _feed is None:
        _feed = MarketPriceFeed()
    return _feed
