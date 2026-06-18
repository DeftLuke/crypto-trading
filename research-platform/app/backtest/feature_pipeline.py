"""Build enriched feature frames from Phase 1 + Phase 2 engines."""

from pathlib import Path

import polars as pl

from app.core.config import get_settings
from app.indicators.engine import compute_all_indicators
from app.indicators.mtf import MultiTimeframeEngine
from app.signals.sessions import SessionEngine
from app.smc.engine import SmcEngine
from app.storage.parquet_store import ParquetStorage


class FeaturePipeline:
    """Load candles, compute indicators + SMC + MTF in memory-efficient chunks."""

    def __init__(self) -> None:
        self.store = ParquetStorage()
        self.smc = SmcEngine()
        self.mtf = MultiTimeframeEngine(self.store)
        self.sessions = SessionEngine()
        self.settings = get_settings()

    def feature_path(self, exchange: str, symbol: str, timeframe: str) -> Path:
        return Path(self.settings.data_root) / "datasets" / exchange / symbol.upper() / f"{timeframe}_features.parquet"

    def load_features(
        self,
        exchange: str,
        symbol: str,
        timeframe: str,
        start_ts: int | None = None,
        end_ts: int | None = None,
        use_cached: bool = True,
    ) -> pl.DataFrame | None:
        cached = self.feature_path(exchange, symbol, timeframe)
        if use_cached and cached.exists():
            lf = pl.scan_parquet(cached)
            if start_ts:
                lf = lf.filter(pl.col("ts") >= start_ts)
            if end_ts:
                lf = lf.filter(pl.col("ts") <= end_ts)
            return lf.collect().sort("ts")

        lf = self.store.read_candles_lazy(exchange, symbol, timeframe)
        if lf is None:
            return None
        if start_ts:
            lf = lf.filter(pl.col("ts") >= start_ts)
        if end_ts:
            lf = lf.filter(pl.col("ts") <= end_ts)

        df = compute_all_indicators(lf).collect().sort("ts")
        if df.is_empty():
            return None

        smc_result = self.smc.analyze(df)
        smc_rows = [b.to_dict() for b in smc_result.bars]
        if smc_rows:
            smc_df = pl.DataFrame(smc_rows).select([
                "ts", "bos", "bos_type", "choch", "choch_type",
                "order_block", "order_block_direction", "order_block_high", "order_block_low",
                "fvg", "fvg_direction", "fvg_top", "fvg_bottom",
                "liquidity_sweep", "sweep_direction", "structure_bias",
            ])
            df = df.join(smc_df, on="ts", how="left", suffix="_smc")

        mtf_df = self.mtf.combine(exchange, symbol, timeframe, ("1h",))
        if mtf_df is not None and not mtf_df.is_empty():
            mtf_cols = [c for c in mtf_df.columns if c != "ts"]
            df = df.join(mtf_df.select(["ts", *mtf_cols]), on="ts", how="left")

        return df

    def build_context(self, row: dict) -> dict:
        """Context dict for StrategyRulesEngine — mirrors AnalysisService.generate_signal."""
        close = row.get("close")
        ema100_1h = row.get("1h_ema100")
        bos_type = row.get("bos_type")
        ctx = dict(row)
        ctx["rsi14"] = row.get("rsi14")
        ctx["close_below_ema100_1h"] = 1 if (close and ema100_1h and close < ema100_1h) else 0
        ctx["bos_bearish"] = 1 if bos_type == "bearish" else 0
        ctx["bos_bullish"] = 1 if bos_type == "bullish" else 0
        atr_pct = (row.get("atr14") or 0) / close * 100 if close else 0
        ctx["volatility_safe"] = 1 if atr_pct < 30 else 0
        session = self.sessions.detect(int(row.get("ts", 0)))
        ctx["session"] = session["session"]
        return ctx
