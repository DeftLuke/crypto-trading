from datetime import UTC, datetime
from pathlib import Path

import polars as pl
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import get_logger
from app.indicators.engine import compute_all_indicators
from app.models.tables import FeatureDataset, FundingRate, OpenInterest
from app.repositories.indicator_repository import IndicatorRepository
from app.smc.engine import SmcEngine
from app.smc.interface import StubSmcDetector
from app.storage.parquet_store import ParquetStorage

logger = get_logger("services.dataset")


class DatasetBuilder:
    """Build research datasets: candles + indicators + SMC stub + market context."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.parquet = ParquetStorage()
        self.smc = StubSmcDetector()
        self.indicator_repo = IndicatorRepository(session)
        self.settings = get_settings()

    async def build(
        self,
        exchange: str,
        symbol: str,
        timeframe: str,
        name: str | None = None,
    ) -> FeatureDataset:
        ds = FeatureDataset(
            name=name or f"{exchange}_{symbol}_{timeframe}_research",
            exchange=exchange,
            symbol=symbol,
            timeframe=timeframe,
            status="running",
        )
        self.session.add(ds)
        await self.session.flush()

        try:
            lf = self.parquet.read_candles_lazy(exchange, symbol, timeframe)
            if lf is None:
                raise FileNotFoundError(f"No parquet data for {exchange}/{symbol}/{timeframe}")

            features = compute_all_indicators(lf)
            candles = lf.collect()
            candle_dicts = candles.to_dicts()

            smc_outputs = self.smc.detect(candle_dicts)
            smc_df = pl.DataFrame({
                "ts": [c["ts"] for c in candle_dicts],
                "bos": [s.bos for s in smc_outputs],
                "choch": [s.choch for s in smc_outputs],
                "order_block": [s.order_block for s in smc_outputs],
                "liquidity_sweep": [s.liquidity_sweep for s in smc_outputs],
                "fvg": [s.fvg for s in smc_outputs],
            })

            funding_df = await self._load_funding(exchange, symbol)
            oi_df = await self._load_open_interest(exchange, symbol)

            dataset = features.join(smc_df, on="ts", how="left")
            if funding_df is not None:
                dataset = dataset.join(funding_df, on="ts", how="left")
            else:
                dataset = dataset.with_columns(pl.lit(None).cast(pl.Float64).alias("funding_rate"))
            if oi_df is not None:
                dataset = dataset.join(oi_df, on="ts", how="left")
            else:
                dataset = dataset.with_columns(pl.lit(None).cast(pl.Float64).alias("open_interest"))

            out_dir = Path(self.settings.data_root) / "datasets" / exchange / symbol.upper()
            out_dir.mkdir(parents=True, exist_ok=True)
            out_path = out_dir / f"{timeframe}_features.parquet"
            dataset.write_parquet(out_path, compression="zstd")

            await self._persist_smc_to_db(exchange, symbol, timeframe, candle_dicts, smc_outputs)

            ds.status = "completed"
            ds.row_count = len(dataset)
            ds.parquet_path = str(out_path)
            ds.from_ts = int(dataset["ts"].min()) if len(dataset) else None
            ds.to_ts = int(dataset["ts"].max()) if len(dataset) else None
            ds.finished_at = datetime.now(UTC)

            logger.info("Dataset built", extra={"path": str(out_path), "rows": len(dataset)})
        except Exception as e:
            ds.status = "failed"
            ds.finished_at = datetime.now(UTC)
            logger.exception("Dataset build failed")
            raise e
        finally:
            await self.session.flush()
        return ds

    async def _load_funding(self, exchange: str, symbol: str) -> pl.DataFrame | None:
        result = await self.session.execute(
            select(FundingRate.ts, FundingRate.rate)
            .where(FundingRate.exchange == exchange, FundingRate.symbol == symbol)
            .order_by(FundingRate.ts)
        )
        rows = result.all()
        if not rows:
            return None
        return pl.DataFrame({
            "ts": [r.ts for r in rows],
            "funding_rate": [r.rate for r in rows],
        })

    async def _load_open_interest(self, exchange: str, symbol: str) -> pl.DataFrame | None:
        result = await self.session.execute(
            select(OpenInterest.ts, OpenInterest.open_interest)
            .where(OpenInterest.exchange == exchange, OpenInterest.symbol == symbol)
            .order_by(OpenInterest.ts)
        )
        rows = result.all()
        if not rows:
            return None
        return pl.DataFrame({
            "ts": [r.ts for r in rows],
            "open_interest": [r.open_interest for r in rows],
        })

    async def _persist_smc_to_db(
        self,
        exchange: str,
        symbol: str,
        timeframe: str,
        candles: list[dict],
        outputs: list,
    ) -> None:
        records = [
            {
                "exchange": exchange,
                "symbol": symbol,
                "timeframe": timeframe,
                "ts": c["ts"],
                "bos": o.bos,
                "choch": o.choch,
                "order_block": o.order_block,
                "liquidity_sweep": o.liquidity_sweep,
                "fvg": o.fvg,
                "details_json": o.to_dict(),
            }
            for c, o in zip(candles, outputs, strict=True)
        ]
        batch_size = 5000
        for i in range(0, len(records), batch_size):
            await self.indicator_repo.upsert_smc(records[i : i + batch_size])
