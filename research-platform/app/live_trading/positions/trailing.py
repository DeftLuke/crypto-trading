"""Live trailing stop — updates SL on exchange when configured."""

from __future__ import annotations

from app.live_trading.types import LivePosition, utc_now


class LiveTrailingEngine:
    def update(self, position: LivePosition, price: float, atr: float | None = None) -> LivePosition:
        direction = position.direction.upper()
        position.current_price = price

        if position.tp1 and not position.tp1_hit and self._hit_tp(direction, price, position.tp1):
            position.tp1_hit = True
            position.stop_loss = position.entry_price

        if position.tp2 and position.tp1_hit and not position.tp2_hit and self._hit_tp(direction, price, position.tp2):
            position.tp2_hit = True
            position.stop_loss = position.tp1

        if position.tp1_hit and position.tp2_hit and atr:
            trail = atr * 1.5
            if direction == "LONG":
                new_sl = price - trail
                if position.trailing_stop is None or new_sl > position.trailing_stop:
                    position.trailing_stop = new_sl
                    position.stop_loss = new_sl
            else:
                new_sl = price + trail
                if position.trailing_stop is None or new_sl < position.trailing_stop:
                    position.trailing_stop = new_sl
                    position.stop_loss = new_sl

        position.unrealized_pnl = self._pnl(position, price, position.quantity)
        position.roe_pct = position.unrealized_pnl / position.margin * 100 * position.leverage if position.margin else 0
        position.updated_at = utc_now()
        return position

    def should_close(self, position: LivePosition, price: float) -> tuple[bool, str]:
        d = position.direction.upper()
        if position.stop_loss and self._hit_sl(d, price, position.stop_loss):
            return True, "stop_loss"
        if position.take_profit and self._hit_tp(d, price, position.take_profit):
            return True, "take_profit"
        if position.trailing_stop and self._hit_sl(d, price, position.trailing_stop):
            return True, "trailing_stop"
        return False, ""

    def _pnl(self, pos: LivePosition, price: float, qty: float) -> float:
        if pos.direction.upper() == "LONG":
            return (price - pos.entry_price) * qty
        return (pos.entry_price - price) * qty

    def _hit_sl(self, direction: str, price: float, sl: float) -> bool:
        return price <= sl if direction == "LONG" else price >= sl

    def _hit_tp(self, direction: str, price: float, tp: float) -> bool:
        return price >= tp if direction == "LONG" else price <= tp
