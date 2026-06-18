import polars as pl

from app.core.logging import get_logger
from app.services.exchange_adapter import TIMEFRAME_MS

logger = get_logger("services.validation")


class ValidationReport:
    def __init__(self, exchange: str, symbol: str, timeframe: str) -> None:
        self.exchange = exchange
        self.symbol = symbol
        self.timeframe = timeframe
        self.issues: list[str] = []
        self.stats: dict = {}

    @property
    def valid(self) -> bool:
        return len(self.issues) == 0

    def to_dict(self) -> dict:
        return {
            "exchange": self.exchange,
            "symbol": self.symbol,
            "timeframe": self.timeframe,
            "valid": self.valid,
            "issues": self.issues,
            "stats": self.stats,
        }


class DataValidator:
    def validate_candles(self, df: pl.DataFrame, exchange: str, symbol: str, timeframe: str) -> ValidationReport:
        report = ValidationReport(exchange, symbol, timeframe)
        if df.is_empty():
            report.issues.append("empty_dataset")
            return report

        required = {"ts", "open", "high", "low", "close", "volume"}
        missing = required - set(df.columns)
        if missing:
            report.issues.append(f"missing_columns:{','.join(sorted(missing))}")
            return report

        dupes = df.group_by("ts").len().filter(pl.col("len") > 1).height
        if dupes > 0:
            report.issues.append(f"duplicate_timestamps:{dupes}")

        unsorted = not df["ts"].is_sorted()
        if unsorted:
            report.issues.append("timestamps_not_sorted")

        invalid_prices = df.filter(
            (pl.col("high") < pl.col("low"))
            | (pl.col("open") <= 0)
            | (pl.col("close") <= 0)
            | (pl.col("volume") < 0)
        ).height
        if invalid_prices > 0:
            report.issues.append(f"invalid_prices:{invalid_prices}")

        tf_ms = TIMEFRAME_MS.get(timeframe, 60_000)
        gaps = self._detect_gaps(df, tf_ms)
        if gaps:
            report.issues.append(f"missing_candles:{len(gaps)}")
            report.stats["gap_count"] = len(gaps)
            report.stats["first_gap_ts"] = gaps[0] if gaps else None

        report.stats["row_count"] = len(df)
        report.stats["first_ts"] = df["ts"].min()
        report.stats["last_ts"] = df["ts"].max()

        if report.issues:
            logger.warning("Validation issues", extra=report.to_dict())
        return report

    def _detect_gaps(self, df: pl.DataFrame, tf_ms: int) -> list[int]:
        ts_sorted = df.sort("ts")["ts"].to_list()
        gaps = []
        for i in range(1, len(ts_sorted)):
            expected = ts_sorted[i - 1] + tf_ms
            actual = ts_sorted[i]
            while expected < actual:
                gaps.append(expected)
                expected += tf_ms
                if len(gaps) > 1000:
                    break
        return gaps
