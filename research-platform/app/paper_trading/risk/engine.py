"""Paper trading risk engine — overrides signals when limits breached."""

from __future__ import annotations

from app.core.config import get_settings
from app.paper_trading.store import PaperStore
from app.paper_trading.types import RiskEvent, SignalIntake, utc_now


class RiskEngine:
    def __init__(self, store: PaperStore) -> None:
        self.store = store
        self.settings = get_settings()
        self.circuit_breaker = False

    def validate_signal(self, account_id: str, signal: SignalIntake) -> tuple[bool, str]:
        if self.circuit_breaker:
            return False, "Circuit breaker active"

        account = self.store.accounts.get(account_id)
        if not account:
            return False, "Account not found"

        open_pos = self.store.get_open_positions(account_id)
        if len(open_pos) >= self.settings.paper_max_positions:
            return False, f"Max positions ({self.settings.paper_max_positions}) reached"

        symbol_exposure = sum(p.notional for p in open_pos if p.symbol == signal.symbol.upper())
        max_sym = account.equity * self.settings.paper_max_symbol_exposure_pct / 100
        if symbol_exposure >= max_sym:
            return False, f"Max symbol exposure for {signal.symbol}"

        total_exposure = sum(p.notional for p in open_pos)
        max_exp = account.equity * self.settings.paper_max_exposure_pct / 100
        if total_exposure >= max_exp:
            return False, "Max portfolio exposure reached"

        if account.balance > 0:
            daily_loss_pct = abs(min(0, account.daily_pnl)) / account.balance * 100
            if daily_loss_pct >= self.settings.paper_max_daily_loss_pct:
                self.circuit_breaker = True
                self._emit(account_id, "circuit_breaker", "Daily loss limit hit")
                return False, "Daily loss limit exceeded"

        sym_count = sum(1 for p in open_pos if p.symbol == signal.symbol.upper())
        if sym_count >= self.settings.paper_max_positions_per_symbol:
            return False, f"Max positions on {signal.symbol}"

        return True, "ok"

    def check_drawdown(self, account_id: str, peak_equity: float) -> bool:
        account = self.store.accounts.get(account_id)
        if not account or peak_equity <= 0:
            return True
        dd = (peak_equity - account.equity) / peak_equity * 100
        if dd >= self.settings.paper_max_drawdown_pct:
            self.circuit_breaker = True
            self._emit(account_id, "drawdown", f"Max drawdown {dd:.1f}%")
            return False
        return True

    def _emit(self, account_id: str, event_type: str, message: str) -> None:
        self.store.risk_events.append(
            RiskEvent(account_id=account_id, event_type=event_type, severity="high", message=message)
        )

    def status(self, account_id: str) -> dict:
        account = self.store.accounts.get(account_id)
        open_pos = self.store.get_open_positions(account_id)
        return {
            "circuit_breaker": self.circuit_breaker,
            "open_positions": len(open_pos),
            "total_exposure": sum(p.notional for p in open_pos),
            "daily_pnl": account.daily_pnl if account else 0,
            "max_positions": self.settings.paper_max_positions,
        }

    def reset_daily(self) -> None:
        self.circuit_breaker = False
        for acc in self.store.accounts.values():
            acc.daily_pnl = 0.0
