"""Position sizing and risk calculations."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class PositionSize:
    quantity: float
    notional: float
    margin: float
    risk_amount: float


def calculate_position_size(
    balance: float,
    entry: float,
    stop_loss: float,
    risk_per_trade: float = 0.01,
    leverage: float = 10.0,
) -> PositionSize:
    """
    Dynamic position sizing: risk fixed % of equity, sized by stop distance.
    quantity = (balance * risk%) / |entry - sl|
    """
    risk_amount = balance * risk_per_trade
    stop_distance = abs(entry - stop_loss)
    if stop_distance <= 0 or entry <= 0:
        return PositionSize(0.0, 0.0, 0.0, risk_amount)

    quantity = risk_amount / stop_distance
    notional = quantity * entry
    margin = notional / max(leverage, 1.0)
    return PositionSize(
        quantity=quantity,
        notional=notional,
        margin=margin,
        risk_amount=risk_amount,
    )


def apply_slippage(price: float, side: str, is_entry: bool, slippage_pct: float) -> float:
    """Slippage works against the trader."""
    if side == "long":
        return price * (1 + slippage_pct) if is_entry else price * (1 - slippage_pct)
    return price * (1 - slippage_pct) if is_entry else price * (1 + slippage_pct)
