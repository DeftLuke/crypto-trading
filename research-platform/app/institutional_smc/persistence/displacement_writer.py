"""Persist displacement records."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.institutional_smc.modules.displacement import DisplacementEngine, DisplacementSnapshot
from app.models.tables import Displacement


async def persist_displacements(
    session: AsyncSession,
    exchange: str,
    symbol: str,
    snapshots: dict[str, DisplacementSnapshot],
) -> int:
    engine = DisplacementEngine()
    written = 0
    for snap in snapshots.values():
        for row in engine.to_rows_for_db(snap, exchange, symbol):
            session.add(Displacement(**row))
            written += 1
    if written:
        await session.flush()
    return written
