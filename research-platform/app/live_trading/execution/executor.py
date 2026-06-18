"""Order execution layer."""

from __future__ import annotations

import time

from app.live_trading.exchanges.binance import BinanceFuturesExchange
from app.live_trading.types import ExecutionLog, LiveOrder, LiveOrderStatus, LiveOrderType, utc_now


class OrderExecutor:
    def __init__(self, exchange: BinanceFuturesExchange) -> None:
        self.exchange = exchange

    async def submit(
        self,
        order: LiveOrder,
        leverage: int,
    ) -> LiveOrder:
        t0 = time.perf_counter()
        await self.exchange.set_leverage(order.symbol, leverage)
        try:
            result = await self.exchange.place_order(
                order.symbol,
                order.direction,
                order.quantity,
                order.order_type,
                order.price,
                order.stop_price,
                order.reduce_only,
            )
            order.exchange_order_id = str(result.get("id", ""))
            order.filled_price = float(result.get("average") or result.get("price") or order.price or 0)
            order.filled_qty = float(result.get("filled") or result.get("amount") or order.quantity)
            order.status = LiveOrderStatus.FILLED
            order.latency_ms = int((time.perf_counter() - t0) * 1000)
            if order.price and order.filled_price:
                order.slippage_bps = abs(order.filled_price - order.price) / order.price * 10_000
        except Exception as e:
            order.status = LiveOrderStatus.REJECTED
            order.latency_ms = int((time.perf_counter() - t0) * 1000)
            raise RuntimeError(str(e)) from e
        return order

    def log(self, store, event: str, **detail) -> ExecutionLog:
        entry = ExecutionLog(event=event, detail=detail, latency_ms=self.exchange.last_latency_ms)
        store.execution_logs.append(entry)
        return entry
