"""
Institutional-grade SMC signal engine — canonical Python implementation.

Supersedes fragmented logic across:
- backend/src/strategy/smc.js (live, in-memory)
- app/signals/confluence.py (old weights)
- app/strategies/e5_institutional/scoring.py (partial coverage)

CP0: contracts + constants only.
CP1–CP7: modules implemented incrementally.
"""

from app.institutional_smc.constants import (
    INSTITUTIONAL_ENGINE_VERSION,
    MIN_TRADE_SCORE,
    MTF_ROLES,
    SCORE_WEIGHTS,
)
from app.institutional_smc.modules.structure import MarketStructureEngine, MarketStructureSnapshot
from app.institutional_smc.orchestrator import InstitutionalSmcOrchestrator
from app.institutional_smc.types import (
    ConfluenceBreakdown,
    FilterResult,
    ModuleStatus,
    TradeSetupExplanation,
    TradeSetupResult,
)

__all__ = [
    "INSTITUTIONAL_ENGINE_VERSION",
    "MIN_TRADE_SCORE",
    "MTF_ROLES",
    "SCORE_WEIGHTS",
    "ConfluenceBreakdown",
    "FilterResult",
    "ModuleStatus",
    "TradeSetupExplanation",
    "TradeSetupResult",
    "MarketStructureEngine",
    "MarketStructureSnapshot",
    "InstitutionalSmcOrchestrator",
]
