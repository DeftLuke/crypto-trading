"""Position sizing engine."""

from __future__ import annotations

from app.core.config import get_settings


LEVERAGE_FALLBACK = [50, 25, 20, 10, 5, 1]


class PositionSizer:
    def __init__(self) -> None:
        self.settings = get_settings()

    def compute(
        self,
        balance: float,
        entry_price: float,
        mode: str = "margin_pct",
        margin_pct: float = 0.5,
        leverage: int | None = None,
        risk_pct: float = 0.01,
        stop_distance_pct: float | None = None,
        fixed_usd: float | None = None,
    ) -> tuple[float, int, float]:
        """
        Returns (quantity, leverage, margin_usd).
        quantity = contracts/coins sized from notional.
        """
        lev = leverage or self.settings.paper_default_leverage
        lev = self._resolve_leverage(lev)

        if mode == "fixed" and fixed_usd:
            notional = fixed_usd * lev
            margin = fixed_usd
        elif mode == "risk_pct" and stop_distance_pct and stop_distance_pct > 0:
            risk_usd = balance * risk_pct
            notional = risk_usd / (stop_distance_pct / 100) * lev
            margin = notional / lev
        elif mode == "margin_pct":
            margin = balance * margin_pct
            notional = margin * lev
        else:
            margin = balance * margin_pct
            notional = margin * lev

        margin = min(margin, balance * 0.95)
        notional = margin * lev
        quantity = notional / entry_price if entry_price > 0 else 0.0
        return quantity, lev, margin

    def _resolve_leverage(self, requested: int) -> int:
        if requested in LEVERAGE_FALLBACK:
            return requested
        for lev in LEVERAGE_FALLBACK:
            if lev <= requested:
                return lev
        return 1
