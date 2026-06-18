"""Standardized trading signal objects."""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class TradingSignal:
    symbol: str
    direction: str  # LONG | SHORT
    confidence: float
    entry: float | None = None
    stop_loss: float | None = None
    tp1: float | None = None
    tp2: float | None = None
    tp3: str | float | None = None
    exchange: str = "binance"
    timeframe: str = "15m"
    confluence: dict[str, Any] = field(default_factory=dict)
    smc: dict[str, Any] = field(default_factory=dict)
    indicators: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "direction": self.direction,
            "confidence": round(self.confidence, 1),
            "entry": self.entry,
            "stop_loss": self.stop_loss,
            "tp1": self.tp1,
            "tp2": self.tp2,
            "tp3": self.tp3,
            "exchange": self.exchange,
            "timeframe": self.timeframe,
            "confluence": self.confluence,
            "smc": self.smc,
            "indicators": self.indicators,
            "metadata": self.metadata,
        }


class SignalBuilder:
    def __init__(self, atr_sl_mult: float = 1.5, atr_tp_mult: float = 2.0) -> None:
        self.atr_sl_mult = atr_sl_mult
        self.atr_tp_mult = atr_tp_mult

    def build(
        self,
        symbol: str,
        direction: str,
        confidence: float,
        price: float,
        atr: float | None,
        exchange: str = "binance",
        timeframe: str = "15m",
        **kwargs: Any,
    ) -> TradingSignal:
        is_long = direction.upper() == "LONG"
        atr = atr or price * 0.01
        sl_dist = atr * self.atr_sl_mult
        tp_dist = atr * self.atr_tp_mult
        if is_long:
            sl = price - sl_dist
            tp1 = price + tp_dist
            tp2 = price + tp_dist * 2
        else:
            sl = price + sl_dist
            tp1 = price - tp_dist
            tp2 = price - tp_dist * 2
        return TradingSignal(
            symbol=symbol,
            direction=direction.upper(),
            confidence=confidence,
            entry=price,
            stop_loss=round(sl, 2),
            tp1=round(tp1, 2),
            tp2=round(tp2, 2),
            tp3="trail",
            exchange=exchange,
            timeframe=timeframe,
            confluence=kwargs.get("confluence", {}),
            smc=kwargs.get("smc", {}),
            indicators=kwargs.get("indicators", {}),
            metadata=kwargs.get("metadata", {}),
        )
