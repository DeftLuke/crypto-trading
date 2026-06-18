"""Trailing stop and breakeven logic."""

from __future__ import annotations

from app.paper_trading.types import PaperPosition, utc_now


class TrailingStopEngine:
    def update(self, position: PaperPosition, price: float, atr: float | None = None) -> PaperPosition:
        direction = position.direction.upper()
        position.current_price = price

        if position.tp1 and not position.tp1_hit:
            if self._hit_tp(direction, price, position.tp1):
                position.tp1_hit = True
                position.stop_loss = position.entry_price  # breakeven

        if position.tp2 and position.tp1_hit and not position.tp2_hit:
            if self._hit_tp(direction, price, position.tp2):
                position.tp2_hit = True
                position.stop_loss = position.tp1  # move SL to TP1

        if position.tp1_hit and position.tp2_hit and atr:
            trail = atr * 1.5
            if direction == "LONG":
                new_trail = price - trail
                if position.trailing_stop is None or new_trail > position.trailing_stop:
                    position.trailing_stop = new_trail
                    position.stop_loss = new_trail
            else:
                new_trail = price + trail
                if position.trailing_stop is None or new_trail < position.trailing_stop:
                    position.trailing_stop = new_trail
                    position.stop_loss = new_trail

        position.updated_at = utc_now()
        return position

    def _hit_tp(self, direction: str, price: float, tp: float) -> bool:
        if direction == "LONG":
            return price >= tp
        return price <= tp

    def should_close(self, position: PaperPosition, price: float) -> tuple[bool, str]:
        direction = position.direction.upper()
        if position.stop_loss and self._hit_sl(direction, price, position.stop_loss):
            return True, "stop_loss"
        if position.take_profit and self._hit_tp(direction, price, position.take_profit):
            return True, "take_profit"
        if position.trailing_stop and self._hit_sl(direction, price, position.trailing_stop):
            return True, "trailing_stop"
        return False, ""

    def _hit_sl(self, direction: str, price: float, sl: float) -> bool:
        if direction == "LONG":
            return price <= sl
        return price >= sl

    def _hit_tp(self, direction: str, price: float, tp: float) -> bool:
        if direction == "LONG":
            return price >= tp
        return price <= tp
