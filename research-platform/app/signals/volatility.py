"""Volatility filter — daily vol % and ATR %."""

from dataclasses import dataclass
from typing import Any

import polars as pl


@dataclass
class VolatilityResult:
    volatility_pct: float
    atr_pct: float
    safe: bool
    threshold: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "volatility": round(self.volatility_pct, 2),
            "atr_pct": round(self.atr_pct, 2),
            "safe": self.safe,
            "threshold": self.threshold,
        }


class VolatilityFilter:
    def __init__(self, threshold_pct: float = 30.0, atr_period: int = 14) -> None:
        self.threshold_pct = threshold_pct
        self.atr_period = atr_period

    def evaluate(self, df: pl.DataFrame) -> VolatilityResult:
        if df.is_empty() or len(df) < 2:
            return VolatilityResult(0, 0, True, self.threshold_pct)
        df = df.sort("ts").tail(min(len(df), 96))
        daily_returns = df.select(
            (pl.col("close").pct_change().abs() * 100).alias("ret")
        )["ret"].drop_nulls()
        vol = float(daily_returns.mean()) if len(daily_returns) else 0
        close = float(df["close"][-1])
        tr_df = df.select(
            pl.max_horizontal(
                pl.col("high") - pl.col("low"),
                (pl.col("high") - pl.col("close").shift(1)).abs(),
                (pl.col("low") - pl.col("close").shift(1)).abs(),
            ).alias("tr")
        )
        atr = float(tr_df["tr"].tail(self.atr_period).mean())
        atr_pct = (atr / close * 100) if close else 0
        safe = vol < self.threshold_pct
        return VolatilityResult(vol, atr_pct, safe, self.threshold_pct)
