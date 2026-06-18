"""Phase 3 backtesting engine — institutional strategy validation."""

from app.backtest.config import BacktestConfig, ExitConfig, RiskConfig
from app.backtest.types import BacktestResult, TradeRecord

__all__ = [
    "BacktestConfig",
    "ExitConfig",
    "RiskConfig",
    "BacktestResult",
    "TradeRecord",
    "BacktestEngine",
]


def __getattr__(name: str):
    if name == "BacktestEngine":
        from app.backtest.engine import BacktestEngine
        return BacktestEngine
    raise AttributeError(name)
