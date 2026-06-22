"""Central configuration for the TradeGPT backtesting engine."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal


@dataclass
class Settings:
    """Runtime configuration — override via environment or CLI in main.py."""

    # Paths (relative to backtest-engine root)
    root_dir: Path = field(default_factory=lambda: Path(__file__).resolve().parent.parent)
    data_dir: Path | None = None
    reports_dir: Path | None = None
    charts_dir: Path | None = None

    # Binance Futures via CCXT
    exchange_id: str = "binanceusdm"
    symbols: list[str] = field(default_factory=lambda: ["BTCUSDT", "ETHUSDT", "SOLUSDT"])
    timeframes: list[str] = field(default_factory=lambda: ["5m", "15m", "1h", "4h"])
    download_limit: int = 1500  # candles per request
    max_history_candles: int = 5000  # per symbol/tf when downloading

    # Strategy timeframes
    htf: str = "4h"
    ltf: str = "15m"
    entry_timeframe: str = "15m"

    # Indicators (defaults — optimizable)
    ema_fast: int = 20
    ema_mid: int = 50
    ema_slow: int = 200
    atr_period: int = 14
    volume_ema_period: int = 20

    # SMC lookbacks
    swing_left: int = 3
    swing_right: int = 3
    fvg_lookback: int = 20
    ob_lookback: int = 30
    sweep_lookback: int = 50

    # Risk
    initial_balance: float = 10_000.0
    risk_per_trade: float = 0.01
    leverage: float = 10.0
    fee_rate: float = 0.0004  # taker fee per side (Binance futures ~0.04%)
    slippage_pct: float = 0.0005  # 0.05% per fill

    # Take profit R multiples
    tp1_rr: float = 2.0
    tp2_rr: float = 3.0

    # Backtest behaviour
    primary_symbol: str = "BTCUSDT"
    run_optimization: bool = False
    optimization_samples: int = 24  # max grid combos to evaluate

    def __post_init__(self) -> None:
        if self.data_dir is None:
            self.data_dir = self.root_dir / "data"
        if self.reports_dir is None:
            self.reports_dir = self.root_dir / "reports"
        if self.charts_dir is None:
            self.charts_dir = self.root_dir / "charts"
        for path in (self.data_dir, self.reports_dir, self.charts_dir):
            path.mkdir(parents=True, exist_ok=True)


def load_settings(**overrides: object) -> Settings:
    """Build settings with optional overrides."""
    settings = Settings()
    for key, value in overrides.items():
        if hasattr(settings, key):
            setattr(settings, key, value)
    settings.__post_init__()
    return settings
