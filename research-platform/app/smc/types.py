"""SMC type definitions and enums."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class Direction(str, Enum):
    BULLISH = "bullish"
    BEARISH = "bearish"
    NEUTRAL = "neutral"


class ZoneStatus(str, Enum):
    ACTIVE = "active"
    MITIGATED = "mitigated"
    INVALIDATED = "invalidated"
    BROKEN = "broken"


class ZoneType(str, Enum):
    OB = "OB"
    FVG = "FVG"
    LIQUIDITY = "LIQUIDITY"
    IDM = "IDM"


class LiquidityType(str, Enum):
    EQUAL_HIGHS = "equal_highs"
    EQUAL_LOWS = "equal_lows"
    INTERNAL_HIGH = "internal_high"
    INTERNAL_LOW = "internal_low"
    EXTERNAL_HIGH = "external_high"
    EXTERNAL_LOW = "external_low"


@dataclass
class SmcOutput:
    """Legacy Phase 1 output shape."""
    bos: bool = False
    choch: bool = False
    order_block: bool = False
    liquidity_sweep: bool = False
    fvg: bool = False

    def to_dict(self) -> dict:
        return {
            "bos": self.bos, "choch": self.choch,
            "order_block": self.order_block,
            "liquidity_sweep": self.liquidity_sweep, "fvg": self.fvg,
        }


@dataclass
class SwingPoint:
    index: int
    ts: int
    price: float
    kind: str  # high | low


@dataclass
class Zone:
    zone_type: ZoneType
    direction: Direction
    top: float
    bottom: float
    ts: int
    status: ZoneStatus = ZoneStatus.ACTIVE
    index: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "zone_type": self.zone_type.value,
            "direction": self.direction.value,
            "top": self.top,
            "bottom": self.bottom,
            "ts": self.ts,
            "status": self.status.value,
            "index": self.index,
            **self.metadata,
        }


@dataclass
class SmcBarOutput:
    ts: int
    bos: bool = False
    bos_type: str | None = None
    choch: bool = False
    choch_type: str | None = None
    order_block: bool = False
    ob_direction: str | None = None
    ob_high: float | None = None
    ob_low: float | None = None
    fvg: bool = False
    fvg_direction: str | None = None
    fvg_top: float | None = None
    fvg_bottom: float | None = None
    liquidity_sweep: bool = False
    sweep_direction: str | None = None
    liquidity_type: str | None = None
    structure_bias: str = "neutral"
    idm: bool = False
    external_structure: str | None = None
    internal_structure: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "bos": self.bos,
            "bos_type": self.bos_type,
            "choch": self.choch,
            "choch_type": self.choch_type,
            "order_block": self.order_block,
            "order_block_direction": self.ob_direction,
            "order_block_high": self.ob_high,
            "order_block_low": self.ob_low,
            "fvg": self.fvg,
            "fvg_direction": self.fvg_direction,
            "fvg_top": self.fvg_top,
            "fvg_bottom": self.fvg_bottom,
            "liquidity_sweep": self.liquidity_sweep,
            "sweep_direction": self.sweep_direction,
            "liquidity_type": self.liquidity_type,
            "structure_bias": self.structure_bias,
            "idm": self.idm,
            "external_structure": self.external_structure,
            "internal_structure": self.internal_structure,
        }


@dataclass
class SmcAnalysisResult:
    bars: list[SmcBarOutput]
    zones: list[Zone]
    swing_highs: list[SwingPoint]
    swing_lows: list[SwingPoint]

    def latest(self) -> SmcBarOutput | None:
        return self.bars[-1] if self.bars else None
