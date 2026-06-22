"""Persist order blocks and fair value gaps."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.institutional_smc.modules.fvg import FVGEngine, FVGSnapshot
from app.institutional_smc.modules.order_blocks import OrderBlockEngine, OrderBlockSnapshot
from app.models.tables import FairValueGap, OrderBlock


async def persist_order_blocks(
    session: AsyncSession,
    exchange: str,
    symbol: str,
    snapshots: dict[str, OrderBlockSnapshot],
) -> int:
    engine = OrderBlockEngine()
    written = 0
    for snap in snapshots.values():
        for row in engine.to_rows_for_db(snap, exchange, symbol):
            session.add(OrderBlock(**row))
            written += 1
    if written:
        await session.flush()
    return written


async def persist_fvgs(
    session: AsyncSession,
    exchange: str,
    symbol: str,
    snapshots: dict[str, FVGSnapshot],
) -> int:
    engine = FVGEngine()
    written = 0
    for snap in snapshots.values():
        for row in engine.to_rows_for_db(snap, exchange, symbol):
            session.add(FairValueGap(**row))
            written += 1
    if written:
        await session.flush()
    return written
