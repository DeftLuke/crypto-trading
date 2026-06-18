"""Qdrant collection definitions for the memory layer."""

from dataclasses import dataclass
from typing import Literal

CollectionName = Literal[
    "trade_memories",
    "strategy_memories",
    "pattern_memories",
    "reflection_memories",
    "risk_memories",
    "market_memories",
    "signal_memories",
    "backtest_memories",
    "agent_state_memories",
    "deployment_memories",
]

ALL_COLLECTIONS: list[CollectionName] = [
    "trade_memories",
    "strategy_memories",
    "pattern_memories",
    "reflection_memories",
    "risk_memories",
    "market_memories",
    "signal_memories",
    "backtest_memories",
    "agent_state_memories",
    "deployment_memories",
]


@dataclass(frozen=True)
class CollectionConfig:
    name: CollectionName
    description: str


COLLECTION_CONFIGS: dict[CollectionName, CollectionConfig] = {
    "trade_memories": CollectionConfig("trade_memories", "Closed and open trade events"),
    "strategy_memories": CollectionConfig("strategy_memories", "Strategy definitions and evolution"),
    "pattern_memories": CollectionConfig("pattern_memories", "Discovered recurring market patterns"),
    "reflection_memories": CollectionConfig("reflection_memories", "AI and system reflections"),
    "risk_memories": CollectionConfig("risk_memories", "Risk events and violations"),
    "market_memories": CollectionConfig("market_memories", "Market context snapshots"),
    "signal_memories": CollectionConfig("signal_memories", "Generated trading signals"),
    "backtest_memories": CollectionConfig("backtest_memories", "Backtest run summaries"),
    "agent_state_memories": CollectionConfig("agent_state_memories", "Agent learning state"),
    "deployment_memories": CollectionConfig("deployment_memories", "Strategy deployment history"),
}
