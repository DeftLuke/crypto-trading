"""Order execution simulator — slippage, latency, partial fills."""

from __future__ import annotations

import random
import time

from app.core.config import get_settings
from app.paper_trading.types import OrderStatus, OrderType, PaperOrder


class ExecutionSimulator:
    def __init__(self) -> None:
        s = get_settings()
        self.slippage_bps = s.paper_slippage_bps
        self.latency_ms = s.paper_latency_ms
        self.spread_bps = s.paper_spread_bps
        self.partial_fill_prob = s.paper_partial_fill_prob

    def simulate_fill(
        self,
        order: PaperOrder,
        market_price: float,
        direction: str,
    ) -> PaperOrder:
        if self.latency_ms > 0:
            time.sleep(min(self.latency_ms, 50) / 1000.0)

        slip = market_price * (self.slippage_bps / 10_000) * random.uniform(0.5, 1.5)
        spread = market_price * (self.spread_bps / 10_000)

        if order.order_type == OrderType.LIMIT and order.price:
            if direction == "LONG" and order.price < market_price:
                order.status = OrderStatus.REJECTED
                return order
            if direction == "SHORT" and order.price > market_price:
                order.status = OrderStatus.REJECTED
                return order
            fill_price = order.price
        else:
            if direction == "LONG":
                fill_price = market_price + slip + spread / 2
            else:
                fill_price = market_price - slip - spread / 2

        fill_qty = order.quantity
        if random.random() < self.partial_fill_prob and fill_qty > 0:
            fill_qty *= random.uniform(0.5, 0.95)
            order.status = OrderStatus.PARTIAL
        else:
            order.status = OrderStatus.FILLED

        order.filled_price = round(fill_price, 8)
        order.filled_qty = round(fill_qty, 8)
        order.slippage_bps = self.slippage_bps
        order.latency_ms = self.latency_ms
        return order

    def check_stop_trigger(self, direction: str, price: float, stop: float) -> bool:
        if direction == "LONG":
            return price <= stop
        return price >= stop

    def check_tp_trigger(self, direction: str, price: float, tp: float) -> bool:
        if direction == "LONG":
            return price >= tp
        return price <= tp
