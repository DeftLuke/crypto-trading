"""Multi-timeframe feature combiner."""

import polars as pl

from app.indicators.registry import ALL_INDICATORS
from app.storage.parquet_store import ParquetStorage

MTF_TIMEFRAMES = ("15m", "30m", "1h", "4h")


class MultiTimeframeEngine:
    """Fetch and combine indicator features across timeframes."""

    def __init__(self, store: ParquetStorage | None = None) -> None:
        self.store = store or ParquetStorage()

    def load_candles(self, exchange: str, symbol: str, timeframe: str) -> pl.LazyFrame | None:
        return self.store.read_candles_lazy(exchange, symbol, timeframe)

    def compute_tf_features(self, lf: pl.LazyFrame, prefix: str) -> pl.DataFrame:
        base = lf.collect().select(["ts", "open", "high", "low", "close", "volume"])
        result = base.select(["ts"])
        for ind in ALL_INDICATORS:
            computed = ind.calculate(lf).collect()
            for col in ind.output_columns:
                if col in computed.columns:
                    result = result.join(
                        computed.select(["ts", pl.col(col).alias(f"{prefix}{col}")]),
                        on="ts",
                        how="left",
                    )
        return result

    def combine(
        self,
        exchange: str,
        symbol: str,
        base_tf: str = "15m",
        higher_tfs: tuple[str, ...] = ("1h", "4h"),
    ) -> pl.DataFrame | None:
        base_lf = self.load_candles(exchange, symbol, base_tf)
        if base_lf is None:
            return None
        combined = self.compute_tf_features(base_lf, f"{base_tf}_")
        for htf in higher_tfs:
            hlf = self.load_candles(exchange, symbol, htf)
            if hlf is None:
                continue
            hdf = self.compute_tf_features(hlf, f"{htf}_")
            combined = combined.join_asof(
                hdf.sort("ts"),
                on="ts",
                strategy="backward",
            )
        return combined

    def latest_snapshot(
        self,
        exchange: str,
        symbol: str,
        base_tf: str = "15m",
        higher_tfs: tuple[str, ...] = ("1h",),
    ) -> dict:
        df = self.combine(exchange, symbol, base_tf, higher_tfs)
        if df is None or df.is_empty():
            return {}
        row = df.tail(1).to_dicts()[0]
        return {k: v for k, v in row.items() if v is not None and k != "ts"}
