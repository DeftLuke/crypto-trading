"""Position sizing, leverage fallback, circuit breaker."""

from app.backtest.config import RiskConfig


class RiskEngine:
    def __init__(self, config: RiskConfig) -> None:
        self.config = config
        self.balance = config.account_balance
        self.peak_balance = config.account_balance
        self.daily_pnl = 0.0
        self.day_start_balance = config.account_balance
        self.current_day: int | None = None
        self.open_positions = 0
        self.halted = False

    def reset_day(self, ts_ms: int) -> None:
        day = ts_ms // 86_400_000
        if self.current_day != day:
            self.current_day = day
            self.daily_pnl = 0.0
            self.day_start_balance = self.balance

    def check_circuit_breaker(self) -> bool:
        if not self.config.circuit_breaker:
            return False
        if self.halted:
            return True
        dd = (self.peak_balance - self.balance) / self.peak_balance if self.peak_balance else 0
        daily_loss = -self.daily_pnl / self.day_start_balance if self.day_start_balance else 0
        if dd >= self.config.max_drawdown_pct:
            self.halted = True
            return True
        if daily_loss >= self.config.max_daily_loss_pct:
            self.halted = True
            return True
        return False

    def can_open_position(self) -> bool:
        if self.check_circuit_breaker():
            return False
        return self.open_positions < self.config.max_open_positions

    def resolve_leverage(self, preferred: int | None = None) -> int:
        chain = (preferred,) if preferred else self.config.leverage_fallback
        if self.config.leverage not in chain:
            chain = (self.config.leverage, *chain)
        for lev in chain:
            if lev > 0:
                return lev
        return 1

    def position_size_usd(self, entry: float, stop_loss: float, leverage: int | None = None) -> float:
        """Risk-based position size with margin cap."""
        lev = self.resolve_leverage(leverage)
        risk_amount = self.balance * self.config.risk_pct
        stop_dist = abs(entry - stop_loss)
        if stop_dist <= 0:
            stop_dist = entry * 0.01
        notional = risk_amount / (stop_dist / entry)
        margin_cap = self.balance * self.config.margin_pct * lev
        return min(notional, margin_cap)

    def register_open(self) -> None:
        self.open_positions += 1

    def register_close(self, pnl_usd: float) -> None:
        self.open_positions = max(0, self.open_positions - 1)
        self.balance += pnl_usd
        self.daily_pnl += pnl_usd
        self.peak_balance = max(self.peak_balance, self.balance)

    def liquidation_price(self, entry: float, direction: str, leverage: int) -> float:
        """Approximate liquidation for isolated margin."""
        liq_buffer = 1 / leverage * 0.9
        if direction == "LONG":
            return entry * (1 - liq_buffer)
        return entry * (1 + liq_buffer)
