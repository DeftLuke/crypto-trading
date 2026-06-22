"""Canonical constants for institutional SMC engine."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

INSTITUTIONAL_ENGINE_VERSION: Final[str] = "v2"
MIN_TRADE_SCORE: Final[float] = 80.0
LEGACY_MIN_SCORE_E5: Final[float] = 85.0  # historical E5 threshold — not used for v2

# Multi-timeframe roles (replaces Node 1h/30m/15m/5m map)
MTF_ROLES: Final[dict[str, str]] = {
    "trend": "1d",
    "bias": "4h",
    "setup": "1h",
    "entry": "15m",
}

MTF_ORDER: Final[tuple[str, ...]] = ("1d", "4h", "1h", "15m")


@dataclass(frozen=True)
class ScoreWeights:
    market_structure: float = 20.0
    liquidity_sweep: float = 20.0
    order_block: float = 12.0
    fvg: float = 10.0
    premium_discount: float = 8.0
    displacement: float = 10.0
    volume_oi: float = 10.0
    ema_alignment: float = 10.0
    rsi_macd: float = 5.0
    volatility: float = 5.0

    @property
    def total(self) -> float:
        return (
            self.market_structure + self.liquidity_sweep + self.order_block
            + self.fvg + self.premium_discount + self.displacement
            + self.volume_oi + self.ema_alignment + self.rsi_macd + self.volatility
        )


SCORE_WEIGHTS = ScoreWeights()

# User spec weights sum to 110 — normalize to 0–100 scale for MIN_TRADE_SCORE gate
RAW_SCORE_MAX: Final[float] = SCORE_WEIGHTS.total  # 110.0


def normalize_confluence_score(raw_score: float) -> float:
    """Map raw weighted sum (max 110) to 0–100 institutional scale."""
    if raw_score <= 0:
        return 0.0
    return min(100.0, (raw_score / RAW_SCORE_MAX) * 100.0)


def raw_score_for_threshold(normalized_threshold: float = MIN_TRADE_SCORE) -> float:
    """Minimum raw points required for a normalized score threshold."""
    return (normalized_threshold / 100.0) * RAW_SCORE_MAX

# Liquidity level quality points (Module 2)
LIQUIDITY_QUALITY_POINTS: Final[dict[str, float]] = {
    "equal_high": 20.0,
    "equal_low": 20.0,
    "session": 25.0,
    "previous_day": 30.0,
    "previous_week": 30.0,
    "multiple_confirmation": 40.0,
}

MANDATORY_EXPLANATION_KEYS: Final[tuple[str, ...]] = (
    "market_structure",
    "liquidity_sweep",
    "order_block",
    "fvg",
    "premium_discount",
    "displacement",
    "filters",
    "confluence",
)

# EMA filter periods (validation layer)
EMA_PERIODS: Final[tuple[int, ...]] = (21, 50, 200)

# Rejection codes (stable for analytics)
class RejectionCode:
    SCORE_BELOW_MIN = "score_below_min"
    EXPLAINABILITY_INCOMPLETE = "explainability_incomplete"
    HTF_MISALIGNMENT = "htf_misalignment"
    PREMIUM_DISCOUNT_VIOLATION = "premium_discount_violation"
    EMA_TREND_FAIL = "ema_trend_fail"
    RSI_FAIL = "rsi_fail"
    MACD_FAIL = "macd_fail"
    VOLATILITY_CHOP = "volatility_chop"
    VOLUME_OI_WEAK = "volume_oi_weak"
    FALSE_BREAKOUT = "false_breakout"
    REGIME_RANGE = "regime_range_penalty"
    ENGINE_OFFLINE = "engine_offline"
    STALE_CANDLES = "stale_candles"
    MODULE_NOT_IMPLEMENTED = "module_not_implemented"
