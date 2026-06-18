"""Portfolio sync from exchange."""

from __future__ import annotations

from app.live_trading.exchanges.binance import BinanceFuturesExchange
from app.live_trading.store import LiveStore
from app.live_trading.types import LiveAccount, utc_now


class PortfolioSync:
    def __init__(self, store: LiveStore, exchange: BinanceFuturesExchange) -> None:
        self.store = store
        self.exchange = exchange

    async def sync_account(self, account_id: str) -> LiveAccount:
        bal = await self.exchange.fetch_balance()
        acc = self.store.accounts.get(account_id)
        if not acc:
            acc = LiveAccount(account_id=account_id, exchange="binance")
            self.store.accounts[account_id] = acc
        acc.balance = bal["total"]
        acc.available = bal["free"]
        acc.equity = bal["total"]
        acc.margin_used = bal["used"]
        acc.updated_at = utc_now()
        self.store._peak_equity[account_id] = max(self.store._peak_equity.get(account_id, acc.equity), acc.equity)
        return acc

    async def sync_positions_from_exchange(self, account_id: str) -> int:
        raw = await self.exchange.fetch_positions()
        count = 0
        for p in raw:
            sym = (p.get("symbol") or "").replace("/", "")
            qty = abs(float(p.get("contracts") or p.get("contractSize") or 0))
            if qty <= 0:
                continue
            count += 1
        return count
