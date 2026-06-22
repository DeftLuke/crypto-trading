"""E5 signal generation with AI score >= threshold."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

import polars as pl

from app.strategies.e5_institutional.constants import SCORE_THRESHOLD
from app.strategies.e5_institutional.scoring import ScoreBreakdown, passes_threshold, score_long


@dataclass
class E5Signal:
    signal_id: str
    symbol: str
    strategy: str
    side: str
    ts: int
    entry: float
    stop_loss: float
    tp1: float
    tp2: float
    tp3: float
    score: float
    score_breakdown: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "strategy": self.strategy,
            "side": self.side.upper(),
            "entry": self.entry,
            "sl": self.stop_loss,
            "tp": self.tp3,
            "tp1": self.tp1,
            "tp2": self.tp2,
            "tp3": self.tp3,
            "score": self.score,
            "time": self.ts,
            **self.score_breakdown,
        }


def generate_e5_signals(
    df: pl.DataFrame,
    symbol: str,
    *,
    strategy_id: str = "E5_INSTITUTIONAL_V1",
    score_threshold: float = SCORE_THRESHOLD,
    tp1_rr: float = 2.0,
    tp2_rr: float = 3.0,
    use_atr_sl: bool = True,
    atr_sl_mult: float = 1.5,
) -> list[E5Signal]:
    signals: list[E5Signal] = []
    rows = df.to_dicts()
    warmup = 220

    for i in range(warmup, len(rows)):
        row = rows[i]

        for side in ("long", "short"):
            breakdown = score_long(row, side)
            if not passes_threshold(breakdown, score_threshold):
                continue

            entry = float(row["close"])
            atr = float(row.get("atr14") or 0)

            if side == "long":
                sweep_low = float(row.get("sweep_low_level") or row.get("order_block_low") or row["low"])
                sl = sweep_low * 0.999 if not use_atr_sl else entry - atr * atr_sl_mult
                risk = entry - sl
                if risk <= 0:
                    continue
                tp1 = entry + risk * tp1_rr
                tp2 = entry + risk * tp2_rr
                tp3 = float(row.get("htf4_close") or row.get("last_swing_high") or tp2 * 1.05)
            else:
                sweep_high = float(row.get("sweep_high_level") or row.get("order_block_high") or row["high"])
                sl = sweep_high * 1.001 if not use_atr_sl else entry + atr * atr_sl_mult
                risk = sl - entry
                if risk <= 0:
                    continue
                tp1 = entry - risk * tp1_rr
                tp2 = entry - risk * tp2_rr
                tp3 = float(row.get("htf4_close") or row.get("last_swing_low") or tp2 * 0.95)

            signals.append(
                E5Signal(
                    signal_id=str(uuid4()),
                    symbol=symbol,
                    strategy=strategy_id,
                    side=side,
                    ts=int(row["ts"]),
                    entry=entry,
                    stop_loss=sl,
                    tp1=tp1,
                    tp2=tp2,
                    tp3=tp3,
                    score=breakdown.total,
                    score_breakdown=breakdown.to_dict(),
                ),
            )
            break  # one signal per bar

    return signals
