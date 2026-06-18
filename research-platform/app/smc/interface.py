"""SMC feature layer — Phase 2 production engine."""

from app.smc.engine import SmcEngine
from app.smc.types import SmcBarOutput, SmcOutput

# Backward compatibility alias
StubSmcDetector = SmcEngine


def bar_to_legacy_output(bar: SmcBarOutput) -> SmcOutput:
    return SmcOutput(
        bos=bar.bos,
        choch=bar.choch,
        order_block=bar.order_block,
        liquidity_sweep=bar.liquidity_sweep,
        fvg=bar.fvg,
    )


class SmcDetector:
    """Protocol-compatible wrapper around SmcEngine."""

    def __init__(self) -> None:
        self._engine = SmcEngine()

    def detect(self, candles: list[dict]) -> list[SmcOutput]:
        return [bar_to_legacy_output(b) for b in self._engine.detect(candles)]

