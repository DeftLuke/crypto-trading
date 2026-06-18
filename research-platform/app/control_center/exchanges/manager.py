"""Multi-exchange connection manager."""

from __future__ import annotations

from typing import Any

from app.control_center.exchanges.adapter import SUPPORTED, create_trading_adapter
from app.control_center.types import ExchangeConnection, utc_now
from app.core.logging import get_logger

logger = get_logger("control_center.exchanges.manager")


class ExchangeManager:
    def __init__(self) -> None:
        self._adapters: dict[str, Any] = {}

    def _adapter(self, exchange_id: str):
        eid = exchange_id.lower()
        if eid not in self._adapters:
            self._adapters[eid] = create_trading_adapter(eid)
        return self._adapters[eid]

    async def connect(self, exchange_id: str) -> ExchangeConnection:
        adapter = self._adapter(exchange_id)
        await adapter.connect()
        return await self.sync(exchange_id)

    async def disconnect(self, exchange_id: str) -> dict[str, Any]:
        adapter = self._adapter(exchange_id)
        await adapter.close()
        return {"disconnected": exchange_id}

    async def sync(self, exchange_id: str) -> ExchangeConnection:
        adapter = self._adapter(exchange_id)
        if not adapter.connected:
            await adapter.connect()
        bal = await adapter.fetch_balance()
        positions = await adapter.fetch_positions()
        st = adapter.status()
        return ExchangeConnection(
            exchange_id=exchange_id,
            label=exchange_id.title(),
            connected=st["connected"],
            api_ok=st["connected"] and not st.get("error"),
            ws_ok=st.get("ws_ok", False),
            dry_run=st["dry_run"],
            latency_ms=st["latency_ms"],
            error_count=st["error_count"],
            balance=bal["total"],
            available=bal["free"],
            open_positions=len(positions),
            last_sync=utc_now(),
        )

    async def test(self, exchange_id: str) -> dict[str, Any]:
        return await self._adapter(exchange_id).test_connection()

    async def all_status(self) -> list[ExchangeConnection]:
        results = []
        for eid in SUPPORTED:
            try:
                results.append(await self.sync(eid))
            except Exception as e:
                results.append(
                    ExchangeConnection(exchange_id=eid, label=eid.title(), connected=False, api_ok=False, dry_run=True)
                )
                logger.warning("Exchange sync failed", extra={"exchange": eid, "error": str(e)})
        return results

    def list_supported(self) -> list[str]:
        return list(SUPPORTED)
