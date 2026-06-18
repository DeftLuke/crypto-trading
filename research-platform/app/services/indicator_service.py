import polars as pl
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.indicators.engine import compute_all_indicators
from app.repositories.indicator_repository import IndicatorRepository
from app.smc.interface import StubSmcDetector
from app.storage.parquet_store import ParquetStorage

logger = get_logger("services.indicators")

INDICATOR_COLUMNS = {
    "ema20": "value",
    "ema50": "value",
    "ema100": "value",
    "ema200": "value",
    "rsi14": "value",
    "atr14": "value",
    "vwap": "value",
}


class IndicatorService:
    """Compute indicators from Parquet and persist to PostgreSQL in batches."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = IndicatorRepository(session)
        self.parquet = ParquetStorage()
        self.smc = StubSmcDetector()
        self.batch_size = 5000

    async def compute_and_persist(
        self,
        exchange: str,
        symbol: str,
        timeframe: str,
    ) -> dict:
        lf = self.parquet.read_candles_lazy(exchange, symbol, timeframe)
        if lf is None:
            return {"rows": 0, "indicators": 0}

        df = compute_all_indicators(lf)
        indicator_rows = self._build_indicator_records(exchange, symbol, timeframe, df)
        smc_rows = self._build_smc_records(exchange, symbol, timeframe, df)

        persisted = 0
        for i in range(0, len(indicator_rows), self.batch_size):
            batch = indicator_rows[i : i + self.batch_size]
            persisted += await self.repo.upsert_indicators(batch)

        smc_persisted = 0
        for i in range(0, len(smc_rows), self.batch_size):
            batch = smc_rows[i : i + self.batch_size]
            smc_persisted += await self.repo.upsert_smc(batch)

        logger.info(
            "Indicators persisted",
            extra={
                "exchange": exchange,
                "symbol": symbol,
                "timeframe": timeframe,
                "indicators": persisted,
                "smc": smc_persisted,
            },
        )
        return {"rows": len(df), "indicators": persisted, "smc": smc_persisted}

    def _build_indicator_records(
        self,
        exchange: str,
        symbol: str,
        timeframe: str,
        df: pl.DataFrame,
    ) -> list[dict]:
        records: list[dict] = []
        scalar_cols = ["ema20", "ema50", "ema100", "ema200", "rsi14", "atr14", "vwap"]
        for row in df.iter_rows(named=True):
            ts = row["ts"]
            for col in scalar_cols:
                val = row.get(col)
                if val is not None:
                    records.append({
                        "exchange": exchange,
                        "symbol": symbol,
                        "timeframe": timeframe,
                        "ts": ts,
                        "indicator": col,
                        "value": float(val),
                        "values_json": None,
                    })
            if row.get("macd") is not None:
                records.append({
                    "exchange": exchange,
                    "symbol": symbol,
                    "timeframe": timeframe,
                    "ts": ts,
                    "indicator": "macd",
                    "value": float(row["macd"]),
                    "values_json": {
                        "macd": row.get("macd"),
                        "macd_signal": row.get("macd_signal"),
                        "macd_hist": row.get("macd_hist"),
                    },
                })
        return records

    def _build_smc_records(
        self,
        exchange: str,
        symbol: str,
        timeframe: str,
        df: pl.DataFrame,
    ) -> list[dict]:
        outputs = self.smc.detect(df.to_dicts())
        return [
            {
                "exchange": exchange,
                "symbol": symbol,
                "timeframe": timeframe,
                "ts": row["ts"],
                "bos": out.bos,
                "choch": out.choch,
                "order_block": out.order_block,
                "liquidity_sweep": out.liquidity_sweep,
                "fvg": out.fvg,
                "details_json": out.to_dict(),
            }
            for row, out in zip(df.iter_rows(named=True), outputs, strict=True)
        ]
