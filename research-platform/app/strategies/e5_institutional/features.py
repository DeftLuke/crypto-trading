"""MTF feature builder for E5 — merges 4h/1h/15m/5m from Parquet (no download)."""

from __future__ import annotations

import polars as pl

from app.indicators.engine import compute_all_indicators
from app.smc.engine import SmcEngine
from app.strategies.e5_institutional.data_loader import InstitutionalDataLoader


def _merge_htf(ltf: pl.DataFrame, htf: pl.DataFrame, prefix: str) -> pl.DataFrame:
    htf = htf.select([
        pl.col("ts"),
        pl.col("close").alias(f"{prefix}_close"),
        pl.col("ema200").alias(f"{prefix}_ema200"),
    ])
    return ltf.join_asof(htf.sort("ts"), on="ts", strategy="backward")


def _trend_flags(df: pl.DataFrame, prefix: str) -> pl.DataFrame:
    close_col = f"{prefix}_close"
    ema_col = f"{prefix}_ema200"
    if close_col not in df.columns or ema_col not in df.columns:
        return df
    return df.with_columns([
        (pl.col(close_col) > pl.col(ema_col)).alias(f"{prefix}_bullish"),
        (pl.col(close_col) < pl.col(ema_col)).alias(f"{prefix}_bearish"),
    ])


def _enrich_smc(df: pl.DataFrame) -> pl.DataFrame:
    smc = SmcEngine()
    result = smc.analyze(df)
    if not result.bars:
        return df
    smc_df = pl.DataFrame([b.to_dict() for b in result.bars])
    cols = [c for c in smc_df.columns if c != "ts"]
    return df.join(smc_df.select(["ts", *cols]), on="ts", how="left")


def _add_sweep_mss(df: pl.DataFrame) -> pl.DataFrame:
    """Derive sweep/MSS flags from SMC columns."""
    return df.with_columns([
        (
            (pl.col("liquidity_sweep") == True) & (pl.col("sweep_direction") == "bullish")  # noqa: E712
        ).fill_null(False).alias("bull_sweep"),
        (
            (pl.col("liquidity_sweep") == True) & (pl.col("sweep_direction") == "bearish")  # noqa: E712
        ).fill_null(False).alias("bear_sweep"),
        (pl.col("bos_type") == "bullish").fill_null(False).alias("bos_bullish"),
        (pl.col("bos_type") == "bearish").fill_null(False).alias("bos_bearish"),
        (pl.col("choch_type") == "bullish").fill_null(False).alias("choch_bullish"),
        (pl.col("choch_type") == "bearish").fill_null(False).alias("choch_bearish"),
    ])


def build_e5_features(
    loader: InstitutionalDataLoader,
    symbol: str,
    start_ts: int | None = None,
    end_ts: int | None = None,
    signal_tf: str = "15m",
) -> pl.DataFrame | None:
    """Load 4h, 1h, 15m (signal), optionally 5m; compute indicators + SMC."""
    df_4h = loader.load(symbol, "4h", start_ts, end_ts)
    df_1h = loader.load(symbol, "1h", start_ts, end_ts)
    df_sig = loader.load(symbol, signal_tf, start_ts, end_ts)
    if df_sig is None:
        return None

    df = compute_all_indicators(df_sig.lazy()).collect().sort("ts")
    df = df.with_columns(pl.col("volume").ewm_mean(span=20).alias("vol_ema20"))
    df = _enrich_smc(df)
    df = _add_sweep_mss(df)

    if df_4h is not None:
        h4 = compute_all_indicators(df_4h.lazy()).collect()
        df = _merge_htf(df, h4, "htf4")
        df = _trend_flags(df, "htf4")
    if df_1h is not None:
        h1 = compute_all_indicators(df_1h.lazy()).collect()
        df = _merge_htf(df, h1, "htf1")
        df = _trend_flags(df, "htf1")

    # OB retest helpers
    df = df.with_columns([
        (
            pl.col("order_block").fill_null(False)
            & (pl.col("order_block_direction") == "bullish")
            & (pl.col("low") <= pl.col("order_block_high"))
            & (pl.col("high") >= pl.col("order_block_low"))
        ).alias("ob_retest_long"),
        (
            pl.col("order_block").fill_null(False)
            & (pl.col("order_block_direction") == "bearish")
            & (pl.col("low") <= pl.col("order_block_high"))
            & (pl.col("high") >= pl.col("order_block_low"))
        ).alias("ob_retest_short"),
    ])
    return df
