from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import FundingRate, OpenInterest


class FundingRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def upsert_funding(self, records: list[dict]) -> int:
        if not records:
            return 0
        stmt = insert(FundingRate).values(records)
        stmt = stmt.on_conflict_do_nothing(constraint="uq_funding_rates_key")
        await self.session.execute(stmt)
        return len(records)

    async def upsert_open_interest(self, records: list[dict]) -> int:
        if not records:
            return 0
        stmt = insert(OpenInterest).values(records)
        stmt = stmt.on_conflict_do_nothing(constraint="uq_open_interest_key")
        await self.session.execute(stmt)
        return len(records)
