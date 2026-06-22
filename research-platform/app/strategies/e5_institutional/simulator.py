"""
E5 trade simulator — fees, slippage, funding, partial TP, liquidation check.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import uuid4

from app.backtest.config import BacktestConfig
from app.backtest.types import EquityPoint, TradeRecord
from app.strategies.e5_institutional.signals import E5Signal


@dataclass
class SimState:
    balance: float
    position: dict | None = None


class E5TradeSimulator:
    FUNDING_INTERVAL_BARS_15M = 32  # ~8 hours

    def __init__(self, config: BacktestConfig, symbol: str) -> None:
        self.config = config
        self.symbol = symbol
        self.trades: list[TradeRecord] = []
        self.equity_curve: list[EquityPoint] = []
        self.balance = config.risk.account_balance
        self.peak = self.balance

    def _fee(self, notional: float) -> float:
        return notional * self.config.fee_rate

    def _slip(self, price: float, side: str, is_entry: bool) -> float:
        slip = self.config.slippage_pct
        if side == "long":
            return price * (1 + slip) if is_entry else price * (1 - slip)
        return price * (1 - slip) if is_entry else price * (1 + slip)

    def _position_size(self, entry: float, sl: float) -> float:
        risk_amt = self.balance * self.config.risk.risk_pct
        dist = abs(entry - sl)
        if dist <= 0:
            return 0.0
        return risk_amt / dist

    def _liquidation_price(self, entry: float, side: str, leverage: float) -> float:
        # Simplified isolated margin liquidation (~90% of maintenance margin)
        liq_move = entry / leverage * 0.9
        return entry - liq_move if side == "long" else entry + liq_move

    def run(self, bars: list[dict], signals: list[E5Signal]) -> None:
        sig_by_ts = {s.ts: s for s in signals}
        pending: E5Signal | None = None
        pos: dict | None = None
        bar_count = 0

        for bar in bars:
            ts = int(bar["ts"])
            high = float(bar["high"])
            low = float(bar["low"])
            open_p = float(bar["open"])
            close = float(bar["close"])

            if pending and pos is None:
                sig = pending
                side = sig.side
                entry = self._slip(open_p, side, True)
                qty = self._position_size(entry, sig.stop_loss)
                if qty > 0:
                    lev = float(self.config.risk.leverage)
                    notional = qty * entry
                    entry_fee = self._fee(notional)
                    self.balance -= entry_fee
                    liq = self._liquidation_price(entry, side, lev)
                    pos = {
                        "side": side,
                        "entry": entry,
                        "qty": qty,
                        "remaining": qty,
                        "sl": sig.stop_loss,
                        "tp1": sig.tp1,
                        "tp2": sig.tp2,
                        "tp3": sig.tp3,
                        "tp1_hit": False,
                        "tp2_hit": False,
                        "entry_ts": ts,
                        "signal": sig,
                        "fees": entry_fee,
                        "funding": 0.0,
                        "liq": liq,
                    }
                pending = None

            if pos:
                side = pos["side"]
                liq = pos["liq"]
                if (side == "long" and low <= liq) or (side == "short" and high >= liq):
                    self._close(pos, liq, ts, "liquidation")
                    pos = None
                elif side == "long":
                    if low <= pos["sl"]:
                        self._close(pos, pos["sl"], ts, "sl")
                        pos = None
                    elif not pos["tp1_hit"] and high >= pos["tp1"]:
                        self._partial(pos, pos["tp1"], ts, "tp1", 0.33)
                        pos["sl"] = pos["entry"]
                        pos["tp1_hit"] = True
                    elif pos["tp1_hit"] and not pos["tp2_hit"] and high >= pos["tp2"]:
                        self._partial(pos, pos["tp2"], ts, "tp2", 0.33)
                        pos["tp2_hit"] = True
                    elif pos["tp2_hit"] and high >= pos["tp3"]:
                        self._close(pos, pos["tp3"], ts, "tp3")
                        pos = None
                else:
                    if high >= pos["sl"]:
                        self._close(pos, pos["sl"], ts, "sl")
                        pos = None
                    elif not pos["tp1_hit"] and low <= pos["tp1"]:
                        self._partial(pos, pos["tp1"], ts, "tp1", 0.33)
                        pos["sl"] = pos["entry"]
                        pos["tp1_hit"] = True
                    elif pos["tp1_hit"] and not pos["tp2_hit"] and low <= pos["tp2"]:
                        self._partial(pos, pos["tp2"], ts, "tp2", 0.33)
                        pos["tp2_hit"] = True
                    elif pos["tp2_hit"] and low <= pos["tp3"]:
                        self._close(pos, pos["tp3"], ts, "tp3")
                        pos = None

                if pos and bar_count % self.FUNDING_INTERVAL_BARS_15M == 0:
                    funding = abs(pos["qty"] * close) * self.config.funding_rate
                    self.balance -= funding
                    pos["funding"] += funding

            if ts in sig_by_ts and pos is None:
                pending = sig_by_ts[ts]

            equity = self.balance
            if pos:
                mark = close
                if pos["side"] == "long":
                    equity += (mark - pos["entry"]) * pos["remaining"]
                else:
                    equity += (pos["entry"] - mark) * pos["remaining"]
            self.peak = max(self.peak, equity)
            dd = (self.peak - equity) / self.peak * 100 if self.peak else 0
            self.equity_curve.append(EquityPoint(ts=ts, balance=self.balance, equity=equity, drawdown_pct=dd))
            bar_count += 1

        if pos:
            self._close(pos, float(bars[-1]["close"]), int(bars[-1]["ts"]), "end")

    def _partial(self, pos: dict, price: float, ts: int, reason: str, frac: float) -> None:
        qty = pos["qty"] * frac
        self._realize(pos, price, qty, ts, reason, final=False)

    def _close(self, pos: dict, price: float, ts: int, reason: str) -> None:
        self._realize(pos, price, pos["remaining"], ts, reason, final=True)

    def _realize(self, pos: dict, price: float, qty: float, ts: int, reason: str, final: bool) -> None:
        side = pos["side"]
        exit_p = self._slip(price, side, False)
        entry = pos["entry"]
        pnl = (exit_p - entry) * qty if side == "long" else (entry - exit_p) * qty
        exit_fee = self._fee(exit_p * qty)
        net = pnl - exit_fee
        self.balance += net
        pos["remaining"] -= qty
        risk = abs(entry - pos["signal"].stop_loss) * qty
        rr = net / risk if risk > 0 else 0
        sig: E5Signal = pos["signal"]
        self.trades.append(
            TradeRecord(
                trade_id=str(uuid4()),
                symbol=self.symbol,
                direction="LONG" if side == "long" else "SHORT",
                entry_time=pos["entry_ts"],
                exit_time=ts,
                entry_price=entry,
                exit_price=exit_p,
                leverage=float(self.config.risk.leverage),
                stop_loss=pos["sl"],
                take_profit=pos["tp3"],
                fees_usd=pos["fees"] + exit_fee,
                funding_fees_usd=pos["funding"],
                result="WIN" if net > 0 else "LOSS",
                profit_usd=net,
                profit_percent=(net / (entry * qty)) * 100 if qty else 0,
                strategy_name=sig.strategy,
                signal_confidence=sig.score,
                exit_reason=reason,
                features_json={"rr": round(rr, 2), "score": sig.score_breakdown},
            ),
        )
