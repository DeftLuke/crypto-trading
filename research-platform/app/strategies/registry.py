"""Registered trading strategies — add new packages under strategies/."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class StrategyMeta:
    id: str
    name: str
    version: str
    description: str
    engine: str  # smc-mtf | e5_institutional


STRATEGY_REGISTRY: dict[str, StrategyMeta] = {
    "smc-mtf": StrategyMeta(
        id="smc-mtf",
        name="SMC Multi-Timeframe",
        version="1.0",
        description="Legacy rules-engine SMC backtest",
        engine="smc-mtf",
    ),
    "E5_INSTITUTIONAL_V1": StrategyMeta(
        id="E5_INSTITUTIONAL_V1",
        name="TradeGPT E5 Institutional",
        version="1.0",
        description="HTF trend + liquidity sweep + MSS + displacement + FVG/OB retest + AI score",
        engine="e5_institutional",
    ),
}


def get_strategy(strategy_id: str) -> StrategyMeta | None:
    return STRATEGY_REGISTRY.get(strategy_id) or STRATEGY_REGISTRY.get(strategy_id.upper())


def is_e5_strategy(strategy_name: str) -> bool:
    meta = get_strategy(strategy_name)
    return meta is not None and meta.engine == "e5_institutional"
