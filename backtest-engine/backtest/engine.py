"""
Candle-by-candle backtesting engine with partial TP management.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Literal

import pandas as pd

from backtest.risk import apply_slippage, calculate_position_size
from config.settings import Settings
from strategies.tradegpt_e5 import Signal

logger = logging.getLogger(__name__)

ExitReason = Literal["sl", "tp1", "tp2", "tp3", "end"]


@dataclass
class OpenPosition:
    side: Literal["long", "short"]
    entry_price: float
    quantity: float
    stop_loss: float
    tp1: float
    tp2: float
    tp3: float
    entry_time: pd.Timestamp
    tp1_hit: bool = False
    tp2_hit: bool = False
    remaining_qty: float = 0.0
    risk_per_unit: float = 0.0

    def __post_init__(self) -> None:
        if self.remaining_qty <= 0:
            self.remaining_qty = self.quantity


@dataclass
class ClosedTrade:
    side: str
    entry_time: pd.Timestamp
    exit_time: pd.Timestamp
    entry_price: float
    exit_price: float
    quantity: float
    pnl: float
    pnl_pct: float
    fees: float
    exit_reason: ExitReason
    r_multiple: float


@dataclass
class BacktestResult:
    trades: list[ClosedTrade] = field(default_factory=list)
    equity_curve: list[dict] = field(default_factory=list)
    final_balance: float = 0.0
    initial_balance: float = 0.0


class BacktestEngine:
    """Simulate trades on OHLCV with fees and slippage."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.balance = settings.initial_balance
        self.position: OpenPosition | None = None
        self.trades: list[ClosedTrade] = []
        self.equity_curve: list[dict] = []

    def _fee(self, notional: float) -> float:
        return notional * self.settings.fee_rate

    def _close_partial(
        self,
        pos: OpenPosition,
        exit_price: float,
        qty: float,
        exit_time: pd.Timestamp,
        reason: ExitReason,
    ) -> float:
        """Close partial quantity; return realized PnL."""
        slip_exit = apply_slippage(
            exit_price, pos.side, is_entry=False, slippage_pct=self.settings.slippage_pct,
        )
        if pos.side == "long":
            pnl = (slip_exit - pos.entry_price) * qty
        else:
            pnl = (pos.entry_price - slip_exit) * qty
        fees = self._fee(slip_exit * qty) + self._fee(pos.entry_price * qty) * (qty / pos.quantity)
        net = pnl - fees
        self.balance += net
        risk = pos.risk_per_unit * qty
        r_mult = net / risk if risk > 0 else 0.0
        self.trades.append(
            ClosedTrade(
                side=pos.side,
                entry_time=pos.entry_time,
                exit_time=exit_time,
                entry_price=pos.entry_price,
                exit_price=slip_exit,
                quantity=qty,
                pnl=net,
                pnl_pct=(net / (pos.entry_price * qty)) * 100 if qty else 0,
                fees=fees,
                exit_reason=reason,
                r_multiple=r_mult,
            ),
        )
        pos.remaining_qty -= qty
        return net

    def _check_exit(self, bar: pd.Series) -> None:
        if not self.position:
            return
        pos = self.position
        high = float(bar["high"])
        low = float(bar["low"])
        ts = bar["datetime"]

        if pos.side == "long":
            if low <= pos.stop_loss:
                self._close_partial(pos, pos.stop_loss, pos.remaining_qty, ts, "sl")
                self.position = None
                return
            if not pos.tp1_hit and high >= pos.tp1:
                qty = pos.quantity * 0.33
                self._close_partial(pos, pos.tp1, qty, ts, "tp1")
                pos.tp1_hit = True
                pos.stop_loss = pos.entry_price
            if pos.tp1_hit and not pos.tp2_hit and high >= pos.tp2:
                qty = pos.quantity * 0.33
                self._close_partial(pos, pos.tp2, qty, ts, "tp2")
                pos.tp2_hit = True
            if pos.tp2_hit and high >= pos.tp3:
                self._close_partial(pos, pos.tp3, pos.remaining_qty, ts, "tp3")
                self.position = None
        else:
            if high >= pos.stop_loss:
                self._close_partial(pos, pos.stop_loss, pos.remaining_qty, ts, "sl")
                self.position = None
                return
            if not pos.tp1_hit and low <= pos.tp1:
                qty = pos.quantity * 0.33
                self._close_partial(pos, pos.tp1, qty, ts, "tp1")
                pos.tp1_hit = True
                pos.stop_loss = pos.entry_price
            if pos.tp1_hit and not pos.tp2_hit and low <= pos.tp2:
                qty = pos.quantity * 0.33
                self._close_partial(pos, pos.tp2, qty, ts, "tp2")
                pos.tp2_hit = True
            if pos.tp2_hit and low <= pos.tp3:
                self._close_partial(pos, pos.tp3, pos.remaining_qty, ts, "tp3")
                self.position = None

    def _open_position(self, signal: Signal, bar: pd.Series) -> None:
        if self.position is not None:
            return
        entry = apply_slippage(
            float(bar["open"]),
            signal.side,
            is_entry=True,
            slippage_pct=self.settings.slippage_pct,
        )
        sizing = calculate_position_size(
            self.balance,
            entry,
            signal.stop_loss,
            self.settings.risk_per_trade,
            self.settings.leverage,
        )
        if sizing.quantity <= 0:
            return
        entry_fee = self._fee(entry * sizing.quantity)
        self.balance -= entry_fee

        self.position = OpenPosition(
            side=signal.side,
            entry_price=entry,
            quantity=sizing.quantity,
            stop_loss=signal.stop_loss,
            tp1=signal.tp1,
            tp2=signal.tp2,
            tp3=signal.tp3,
            entry_time=bar["datetime"],
            risk_per_unit=signal.risk_per_unit,
        )

    def run(self, df: pd.DataFrame, signals: list[Signal]) -> BacktestResult:
        """Run backtest: signals trigger entry on next bar open."""
        signal_by_bar = {s.index: s for s in signals}
        pending: Signal | None = None

        for i in range(len(df)):
            bar = df.iloc[i]

            if pending and self.position is None:
                self._open_position(pending, bar)
                pending = None

            self._check_exit(bar)

            if i in signal_by_bar and self.position is None:
                pending = signal_by_bar[i]

            equity = self.balance
            if self.position:
                mark = float(bar["close"])
                pos = self.position
                if pos.side == "long":
                    equity += (mark - pos.entry_price) * pos.remaining_qty
                else:
                    equity += (pos.entry_price - mark) * pos.remaining_qty

            self.equity_curve.append({"datetime": bar["datetime"], "equity": equity})

        if self.position and len(df):
            last = df.iloc[-1]
            self._close_partial(
                self.position,
                float(last["close"]),
                self.position.remaining_qty,
                last["datetime"],
                "end",
            )
            self.position = None

        return BacktestResult(
            trades=self.trades,
            equity_curve=self.equity_curve,
            final_balance=self.balance,
            initial_balance=self.settings.initial_balance,
        )
