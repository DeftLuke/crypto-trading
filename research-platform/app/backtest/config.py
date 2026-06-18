"""Backtest configuration — serializable, DB-persistable."""

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any


class BacktestMode(str, Enum):
    SINGLE = "single"
    MULTI = "multi"
    PORTFOLIO = "portfolio"
    WALKFORWARD = "walkforward"
    MONTE_CARLO = "monte_carlo"


class ExitMode(str, Enum):
    FIXED_TP = "fixed_tp"
    FIXED_SL = "fixed_sl"
    ATR_TP = "atr_tp"
    ATR_SL = "atr_sl"
    RR_TP = "rr_tp"
    TRAILING = "trailing"
    TIME = "time"
    STRUCTURE = "structure"
    PARTIAL = "partial"
    BREAKEVEN = "breakeven"


class MarginMode(str, Enum):
    CROSS = "cross"
    ISOLATED = "isolated"


@dataclass
class ExitConfig:
    tp_mode: ExitMode = ExitMode.ATR_TP
    sl_mode: ExitMode = ExitMode.ATR_SL
    atr_sl_mult: float = 1.5
    atr_tp_mult: float = 2.0
    risk_reward: float = 2.0
    trailing_pct: float = 0.015
    max_bars: int = 96
    partial_tp_pct: float = 0.5
    breakeven_after_rr: float = 1.0
    use_tp2: bool = True
    use_trailing: bool = True

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["tp_mode"] = self.tp_mode.value
        d["sl_mode"] = self.sl_mode.value
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ExitConfig":
        data = dict(data)
        if "tp_mode" in data:
            data["tp_mode"] = ExitMode(data["tp_mode"])
        if "sl_mode" in data:
            data["sl_mode"] = ExitMode(data["sl_mode"])
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class RiskConfig:
    account_balance: float = 100.0
    risk_pct: float = 0.01
    margin_pct: float = 0.5
    leverage: int = 50
    leverage_fallback: tuple[int, ...] = (50, 25, 20, 10, 5)
    max_open_positions: int = 5
    max_daily_loss_pct: float = 0.03
    max_drawdown_pct: float = 0.15
    circuit_breaker: bool = True
    margin_mode: MarginMode = MarginMode.CROSS
    allow_pyramiding: bool = False
    max_pyramid_levels: int = 1

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["margin_mode"] = self.margin_mode.value
        d["leverage_fallback"] = list(self.leverage_fallback)
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "RiskConfig":
        data = dict(data)
        if "margin_mode" in data:
            data["margin_mode"] = MarginMode(data["margin_mode"])
        if "leverage_fallback" in data:
            data["leverage_fallback"] = tuple(data["leverage_fallback"])
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class BacktestConfig:
    strategy_name: str = "smc-mtf"
    exchange: str = "binance"
    timeframe: str = "15m"
    mtf_timeframes: tuple[str, ...] = ("1h",)
    symbols: list[str] = field(default_factory=lambda: ["BTCUSDT"])
    mode: BacktestMode = BacktestMode.SINGLE
    start_ts: int | None = None
    end_ts: int | None = None
    fee_rate: float = 0.0004
    slippage_pct: float = 0.0002
    funding_rate: float = 0.0001
    chunk_size: int = 5000
    max_workers: int = 4
    exit: ExitConfig = field(default_factory=ExitConfig)
    risk: RiskConfig = field(default_factory=RiskConfig)
    walkforward_train_months: int = 10
    walkforward_validate_months: int = 2
    monte_carlo_simulations: int = 1000
    min_confidence: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "strategy_name": self.strategy_name,
            "exchange": self.exchange,
            "timeframe": self.timeframe,
            "mtf_timeframes": list(self.mtf_timeframes),
            "symbols": self.symbols,
            "mode": self.mode.value,
            "start_ts": self.start_ts,
            "end_ts": self.end_ts,
            "fee_rate": self.fee_rate,
            "slippage_pct": self.slippage_pct,
            "funding_rate": self.funding_rate,
            "chunk_size": self.chunk_size,
            "max_workers": self.max_workers,
            "exit": self.exit.to_dict(),
            "risk": self.risk.to_dict(),
            "walkforward_train_months": self.walkforward_train_months,
            "walkforward_validate_months": self.walkforward_validate_months,
            "monte_carlo_simulations": self.monte_carlo_simulations,
            "min_confidence": self.min_confidence,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "BacktestConfig":
        data = dict(data)
        if "mode" in data:
            data["mode"] = BacktestMode(data["mode"])
        if "mtf_timeframes" in data:
            data["mtf_timeframes"] = tuple(data["mtf_timeframes"])
        if "exit" in data:
            data["exit"] = ExitConfig.from_dict(data["exit"])
        if "risk" in data:
            data["risk"] = RiskConfig.from_dict(data["risk"])
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})
