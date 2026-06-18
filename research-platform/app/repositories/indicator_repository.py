from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import IndicatorValue, SmcFeature


class IndicatorRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def upsert_indicators(self, records: list[dict]) -> int:
        if not records:
            return 0
        stmt = insert(IndicatorValue).values(records)
        stmt = stmt.on_conflict_do_update(
            constraint="uq_indicator_values_key",
            set_={
                "value": stmt.excluded.value,
                "values_json": stmt.excluded.values_json,
            },
        )
        await self.session.execute(stmt)
        return len(records)

    async def upsert_smc(self, records: list[dict]) -> int:
        if not records:
            return 0
        stmt = insert(SmcFeature).values(records)
        stmt = stmt.on_conflict_do_update(
            constraint="uq_smc_features_key",
            set_={
                "bos": stmt.excluded.bos,
                "choch": stmt.excluded.choch,
                "order_block": stmt.excluded.order_block,
                "liquidity_sweep": stmt.excluded.liquidity_sweep,
                "fvg": stmt.excluded.fvg,
                "details_json": stmt.excluded.details_json,
            },
        )
        await self.session.execute(stmt)
        return len(records)
