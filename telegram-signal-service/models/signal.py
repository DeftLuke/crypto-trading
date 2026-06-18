from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any


class SignalValidationError(ValueError):
    pass


@dataclass
class NormalizedSignal:
    provider: str
    symbol: str
    side: str
    entry: float
    stop_loss: float
    take_profit: list[float]
    raw_message: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    provider_message_id: int | None = None
    source_chat_id: int | None = None
    parser: str = "rule"
    confidence: float | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def validate(self) -> "NormalizedSignal":
        self.symbol = self.symbol.upper().replace("/", "").replace("-", "")
        self.side = self.side.upper()

        if not self.provider:
            raise SignalValidationError("provider is required")
        if not self.symbol.endswith("USDT") or len(self.symbol) < 6:
            raise SignalValidationError("symbol must be a USDT futures pair")
        if self.side not in {"LONG", "SHORT"}:
            raise SignalValidationError("side must be LONG or SHORT")
        if self.entry <= 0 or self.stop_loss <= 0:
            raise SignalValidationError("entry and stop_loss must be positive")
        if len(self.take_profit) < 2:
            raise SignalValidationError("at least TP1 and TP2 are required")

        if self.side == "LONG":
            if not self.stop_loss < self.entry:
                raise SignalValidationError("LONG stop_loss must be below entry")
            if not all(tp > self.entry for tp in self.take_profit[:2]):
                raise SignalValidationError("LONG take profits must be above entry")
        else:
            if not self.stop_loss > self.entry:
                raise SignalValidationError("SHORT stop_loss must be above entry")
            if not all(tp < self.entry for tp in self.take_profit[:2]):
                raise SignalValidationError("SHORT take profits must be below entry")

        return self

    def ensure_take_profits(self) -> "NormalizedSignal":
        """Derive TP2/TP3 from risk multiples when the group only gives one target."""
        risk = abs(self.entry - self.stop_loss)
        if risk <= 0:
            return self

        tps = list(self.take_profit or [])
        if self.side == "LONG":
            if not tps:
                tps = [self.entry + risk, self.entry + 2 * risk, self.entry + 3 * risk]
            elif len(tps) == 1:
                tps = [tps[0], tps[0] + risk, tps[0] + 2 * risk]
            elif len(tps) == 2:
                tps = [tps[0], tps[1], tps[1] + risk]
        else:
            if not tps:
                tps = [self.entry - risk, self.entry - 2 * risk, self.entry - 3 * risk]
            elif len(tps) == 1:
                tps = [tps[0], tps[0] - risk, tps[0] - 2 * risk]
            elif len(tps) == 2:
                tps = [tps[0], tps[1], tps[1] - risk]

        self.take_profit = tps[:3]
        return self

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def to_main_api_payload(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "symbol": self.symbol,
            "side": self.side,
            "entry": self.entry,
            "stop_loss": self.stop_loss,
            "take_profit": self.take_profit,
            "raw_message": self.raw_message,
            "timestamp": self.timestamp,
            "provider_message_id": self.provider_message_id,
            "source_chat_id": self.source_chat_id,
            "parser": self.parser,
            "confidence": self.confidence,
            "metadata": self.metadata,
        }
