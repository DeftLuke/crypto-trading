"""Type contracts for explainable institutional SMC setups."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any


class SetupStatus(str, Enum):
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    CANDIDATE = "candidate"


class ModuleStatus(str, Enum):
    PASS = "pass"
    FAIL = "fail"
    PARTIAL = "partial"
    NOT_DETECTED = "not_detected"
    NOT_IMPLEMENTED = "not_implemented"


@dataclass(kw_only=True)
class FilterResult:
    name: str
    status: ModuleStatus
    score: float = 0.0
    reason: str = ""
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "status": self.status.value,
            "score": self.score,
            "reason": self.reason,
            "details": self.details,
        }


@dataclass(kw_only=True)
class ConfluenceBreakdown:
    market_structure: float = 0.0
    liquidity_sweep: float = 0.0
    order_block: float = 0.0
    fvg: float = 0.0
    premium_discount: float = 0.0
    displacement: float = 0.0
    volume_oi: float = 0.0
    ema_alignment: float = 0.0
    rsi_macd: float = 0.0
    volatility: float = 0.0

    @property
    def total(self) -> float:
        return (
            self.market_structure + self.liquidity_sweep + self.order_block
            + self.fvg + self.premium_discount + self.displacement
            + self.volume_oi + self.ema_alignment + self.rsi_macd + self.volatility
        )

    def to_dict(self) -> dict[str, float]:
        d = asdict(self)
        d["total"] = self.total
        return d


@dataclass(kw_only=True)
class TradeSetupExplanation:
    """
    Mandatory explainability payload — every field documents WHY.

    If any mandatory section is empty or NOT_IMPLEMENTED at CP6+,
    the setup must be rejected.
    """

    market_structure: dict[str, Any] = field(default_factory=dict)
    liquidity_sweep: dict[str, Any] = field(default_factory=dict)
    order_block: dict[str, Any] = field(default_factory=dict)
    fvg: dict[str, Any] = field(default_factory=dict)
    premium_discount: dict[str, Any] = field(default_factory=dict)
    displacement: dict[str, Any] = field(default_factory=dict)
    filters: list[FilterResult] = field(default_factory=list)
    confluence: ConfluenceBreakdown = field(default_factory=ConfluenceBreakdown)
    mtf: dict[str, Any] = field(default_factory=dict)
    human_summary: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "market_structure": self.market_structure,
            "liquidity_sweep": self.liquidity_sweep,
            "order_block": self.order_block,
            "fvg": self.fvg,
            "premium_discount": self.premium_discount,
            "displacement": self.displacement,
            "filters": [f.to_dict() for f in self.filters],
            "confluence": self.confluence.to_dict(),
            "mtf": self.mtf,
            "human_summary": self.human_summary,
        }

    def explainability_complete(self, mandatory_keys: tuple[str, ...]) -> bool:
        data = self.to_dict()
        for key in mandatory_keys:
            section = data.get(key)
            if not section:
                return False
            if isinstance(section, dict) and section.get("status") == ModuleStatus.NOT_IMPLEMENTED.value:
                return False
        if not self.filters:
            return False
        return True


def make_trade_setup_explanation(
    *,
    market_structure: dict[str, Any] | None = None,
    liquidity_sweep: dict[str, Any] | None = None,
    order_block: dict[str, Any] | None = None,
    fvg: dict[str, Any] | None = None,
    premium_discount: dict[str, Any] | None = None,
    displacement: dict[str, Any] | None = None,
    filters: list[FilterResult] | None = None,
    confluence: ConfluenceBreakdown | None = None,
    mtf: dict[str, Any] | None = None,
    human_summary: str = "",
) -> TradeSetupExplanation:
    """Typed factory — avoids IDE false positives on dataclass kwargs."""
    return TradeSetupExplanation(
        market_structure=market_structure or {},
        liquidity_sweep=liquidity_sweep or {},
        order_block=order_block or {},
        fvg=fvg or {},
        premium_discount=premium_discount or {},
        displacement=displacement or {},
        filters=filters or [],
        confluence=confluence or ConfluenceBreakdown(),
        mtf=mtf or {},
        human_summary=human_summary,
    )


@dataclass(kw_only=True)
class TradeSetupResult:
    """Output of InstitutionalSmcOrchestrator.analyze()."""

    symbol: str
    direction: str  # LONG | SHORT | IGNORE
    status: SetupStatus
    engine_version: str
    confluence_score: float
    confluence_breakdown: ConfluenceBreakdown
    explanation: TradeSetupExplanation
    rejection_codes: list[str] = field(default_factory=list)
    rejection_reasons: list[str] = field(default_factory=list)
    entry_price: float | None = None
    stop_loss: float | None = None
    tp1: float | None = None
    tp2: float | None = None
    tp3: float | None = None
    mtf_aligned: bool = False
    modules_implemented: list[str] = field(default_factory=list)
    modules_pending: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "direction": self.direction,
            "status": self.status.value,
            "engine_version": self.engine_version,
            "confluence_score": self.confluence_score,
            "confluence_breakdown": self.confluence_breakdown.to_dict(),
            "explanation": self.explanation.to_dict(),
            "rejection_codes": self.rejection_codes,
            "rejection_reasons": self.rejection_reasons,
            "entry_price": self.entry_price,
            "stop_loss": self.stop_loss,
            "tp1": self.tp1,
            "tp2": self.tp2,
            "tp3": self.tp3,
            "mtf_aligned": self.mtf_aligned,
            "modules_implemented": self.modules_implemented,
            "modules_pending": self.modules_pending,
        }
