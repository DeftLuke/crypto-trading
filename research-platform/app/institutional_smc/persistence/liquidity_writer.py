"""Persist liquidity levels and sweeps."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.institutional_smc.modules.liquidity import LiquidityEngine, LiquiditySnapshot
from app.institutional_smc.modules.sweeps import SweepEngine, SweepSnapshot
from app.models.tables import LiquidityLevel, LiquiditySweep


async def persist_liquidity_levels(
    session: AsyncSession,
    exchange: str,
    symbol: str,
    snapshots: dict[str, LiquiditySnapshot],
) -> int:
    engine = LiquidityEngine()
    written = 0
    for snap in snapshots.values():
        for row in engine.to_rows_for_db(snap, exchange, symbol):
            session.add(LiquidityLevel(**row))
            written += 1
    if written:
        await session.flush()
    return written


async def persist_sweeps(
    session: AsyncSession,
    exchange: str,
    symbol: str,
    snapshots: dict[str, SweepSnapshot],
    *,
    recent_limit: int = 20,
) -> int:
    engine = SweepEngine()
    written = 0
    for snap in snapshots.values():
        for row in engine.to_rows_for_db(snap, exchange, symbol, recent_limit=recent_limit):
            session.add(LiquiditySweep(**row))
            written += 1
    if written:
        await session.flush()
    return written
