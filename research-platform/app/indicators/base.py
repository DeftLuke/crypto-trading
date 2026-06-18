"""Indicator framework — calculate / validate / serialize contract."""

from abc import ABC, abstractmethod
from typing import Any

import polars as pl


class BaseIndicator(ABC):
    """Reusable indicator module compatible with Polars LazyFrames."""

    name: str
    output_columns: list[str]

    @abstractmethod
    def calculate(self, lf: pl.LazyFrame) -> pl.LazyFrame:
        """Return LazyFrame with ts + indicator column(s)."""

    def validate(self, df: pl.DataFrame) -> bool:
        required = {"ts", "open", "high", "low", "close", "volume"}
        if not required.issubset(set(df.columns)):
            return False
        if df.is_empty():
            return False
        return True

    def serialize(self, row: dict[str, Any]) -> dict[str, Any]:
        """Extract this indicator's values from a combined feature row."""
        out: dict[str, Any] = {}
        for col in self.output_columns:
            if col in row and row[col] is not None:
                out[col] = row[col]
        return out

    def compute(self, lf: pl.LazyFrame) -> pl.LazyFrame:
        """Backward-compatible alias for Phase 1."""
        return self.calculate(lf)
