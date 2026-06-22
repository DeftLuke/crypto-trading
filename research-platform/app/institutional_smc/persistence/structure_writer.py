"""Write structure_events to Supabase/Postgres."""

from __future__ import annotations

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.institutional_smc.modules.structure import MarketStructureEngine, MarketStructureSnapshot
from app.models.tables import StructureEvent


async def persist_structure_events(
    session: AsyncSession,
    exchange: str,
    symbol: str,
    snapshots: dict[str, MarketStructureSnapshot],
    *,
    recent_limit: int = 50,
) -> int:
    """Upsert recent structure events for all timeframes. Returns rows written."""
    engine = MarketStructureEngine()
    rows: list[dict] = []
    for _tf, snap in snapshots.items():
        rows.extend(engine.to_rows_for_db(snap, exchange, symbol, recent_limit=recent_limit))

    if not rows:
        return 0

    written = 0
    for row in rows:
        stmt = insert(StructureEvent).values(**row)
        stmt = stmt.on_conflict_do_nothing(constraint="uq_structure_events_key")
        result = await session.execute(stmt)
        written += result.rowcount or 0

    await session.flush()
    return written
