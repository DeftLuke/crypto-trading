"""Walk-forward validation with rolling train/validate windows."""

from datetime import UTC, datetime
from typing import Any

import polars as pl

from app.backtest.config import BacktestConfig
from app.signals.rules_engine import StrategyRule


class WalkForwardEngine:
    def __init__(self, config: BacktestConfig, rules: list[StrategyRule]) -> None:
        self.config = config
        self.rules = rules

    def run(self, df: pl.DataFrame, symbol: str) -> list[dict[str, Any]]:
        from app.backtest.engine import BacktestEngine

        engine = BacktestEngine(self.config, self.rules)
        if df.is_empty():
            return []
        train_ms = self.config.walkforward_train_months * 30 * 86_400_000
        val_ms = self.config.walkforward_validate_months * 30 * 86_400_000
        window = train_ms + val_ms

        ts_min = int(df["ts"].min())
        ts_max = int(df["ts"].max())
        folds = []
        fold = 0
        cursor = ts_min

        while cursor + window <= ts_max:
            train_end = cursor + train_ms
            val_end = cursor + window
            train_df = df.filter((pl.col("ts") >= cursor) & (pl.col("ts") < train_end))
            val_df = df.filter((pl.col("ts") >= train_end) & (pl.col("ts") <= val_end))

            val_result = engine.run_symbol(symbol, preloaded=val_df)
            folds.append({
                "fold": fold,
                "train_start_ts": cursor,
                "train_end_ts": train_end,
                "validate_start_ts": train_end,
                "validate_end_ts": val_end,
                "train_bars": len(train_df),
                "validate_bars": len(val_df),
                "validate_metrics": val_result.metrics,
            })
            fold += 1
            cursor += val_ms

        return folds
