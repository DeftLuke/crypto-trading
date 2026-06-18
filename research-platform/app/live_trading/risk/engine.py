"""Live trading risk engine — highest priority layer."""

from __future__ import annotations

from app.core.config import get_settings
from app.live_trading.store import LiveStore
from app.live_trading.types import CircuitBreakerState, LiveSignal, utc_now


class LiveRiskEngine:
    def __init__(self, store: LiveStore) -> None:
        self.store = store
        self.settings = get_settings()

    def validate_signal(self, account_id: str, signal: LiveSignal) -> tuple[bool, str]:
        cb = self.store.circuit
        if cb.kill_switch:
            return False, "Kill switch active"
        if cb.trading_paused:
            return False, "Trading paused"
        if cb.active:
            return False, f"Circuit breaker: {cb.reason}"
        if signal.strategy_name in cb.disabled_strategies:
            return False, f"Strategy '{signal.strategy_name}' disabled"

        account = self.store.accounts.get(account_id)
        if not account:
            return False, "Account not found"

        open_pos = self.store.open_positions(account_id)
        if len(open_pos) >= self.settings.live_max_positions:
            return False, f"Max open trades ({self.settings.live_max_positions})"

        sym_pos = [p for p in open_pos if p.symbol == signal.symbol.upper()]
        if len(sym_pos) >= self.settings.live_max_positions_per_symbol:
            return False, f"Max positions on {signal.symbol}"

        exposure = sum(p.notional for p in open_pos)
        max_exp = account.equity * self.settings.live_max_exposure_pct / 100
        if exposure >= max_exp:
            return False, "Max portfolio exposure"

        sym_exp = sum(p.notional for p in sym_pos)
        max_sym = account.equity * self.settings.live_max_symbol_exposure_pct / 100
        if sym_exp >= max_sym:
            return False, f"Max symbol exposure on {signal.symbol}"

        if account.balance > 0:
            daily_loss = abs(min(0, account.daily_pnl)) / account.balance * 100
            if daily_loss >= self.settings.live_max_daily_loss_pct:
                self.trigger_circuit("Daily loss limit exceeded")
                return False, "Daily loss limit hit"

        margin_pct = account.margin_used / account.equity * 100 if account.equity else 0
        if margin_pct >= self.settings.live_max_margin_usage_pct:
            return False, "Max margin usage exceeded"

        return True, "ok"

    def check_drawdown(self, account_id: str) -> bool:
        account = self.store.accounts.get(account_id)
        if not account:
            return True
        peak = self.store._peak_equity.get(account_id, account.equity)
        if peak <= 0:
            return True
        dd = (peak - account.equity) / peak * 100
        if dd >= self.settings.live_max_drawdown_pct:
            self.trigger_circuit(f"Max drawdown {dd:.1f}%")
            return False
        return True

    def trigger_circuit(self, reason: str) -> None:
        self.store.circuit = CircuitBreakerState(active=True, reason=reason, triggered_at=utc_now())

    def activate_kill_switch(self) -> None:
        self.store.circuit.kill_switch = True
        self.store.circuit.active = True
        self.store.circuit.reason = "Kill switch activated"
        self.store.circuit.triggered_at = utc_now()

    def reset_circuit(self) -> None:
        self.store.circuit = CircuitBreakerState()

    def pause_trading(self) -> None:
        self.store.circuit.trading_paused = True

    def resume_trading(self) -> None:
        self.store.circuit.trading_paused = False
        if not self.store.circuit.kill_switch:
            self.store.circuit.active = False

    def disable_strategy(self, strategy_name: str) -> None:
        if strategy_name not in self.store.circuit.disabled_strategies:
            self.store.circuit.disabled_strategies.append(strategy_name)

    def status(self, account_id: str) -> dict:
        account = self.store.accounts.get(account_id)
        open_pos = self.store.open_positions(account_id)
        return {
            **self.store.circuit.model_dump(mode="json"),
            "open_positions": len(open_pos),
            "total_exposure": sum(p.notional for p in open_pos),
            "daily_pnl": account.daily_pnl if account else 0,
            "margin_used_pct": (account.margin_used / account.equity * 100 if account and account.equity else 0),
        }
