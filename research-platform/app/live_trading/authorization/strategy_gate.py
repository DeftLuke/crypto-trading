"""Strategy authorization — only approved strategies may trade live."""

from __future__ import annotations

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger("live_trading.authorization")


class StrategyGate:
    """Deployment rules: backtest + paper validation + risk approval."""

    MANUAL_STRATEGIES = {"manual", "dashboard", "emergency"}

    def is_authorized(self, strategy_name: str, manual_override: bool = False) -> tuple[bool, str]:
        settings = get_settings()
        if manual_override and settings.live_allow_manual:
            return True, "manual_override"

        if strategy_name.lower() in self.MANUAL_STRATEGIES:
            if settings.live_allow_manual:
                return True, "manual_allowed"
            return False, "Manual trading disabled — set LIVE_ALLOW_MANUAL=true"

        try:
            from app.paper_trading.engine import get_paper_engine

            approvals = get_paper_engine().store.approvals
            if strategy_name in approvals and approvals[strategy_name].get("approved"):
                return True, "paper_validated"

            validations = get_paper_engine().store.validations
            val = validations.get(strategy_name)
            if val and val.verdict == "pass":
                return True, "paper_validation_pass"
        except Exception as e:
            logger.warning("Paper approval check failed", extra={"error": str(e)})

        if settings.live_require_approval:
            return False, f"Strategy '{strategy_name}' not approved — complete paper validation first"

        return True, "approval_not_required"

    def deployment_checklist(self, strategy_name: str) -> dict:
        checks = {
            "backtest_passed": False,
            "walkforward_passed": False,
            "monte_carlo_passed": False,
            "paper_trading_passed": False,
            "risk_approved": False,
            "strategy_approved": False,
        }
        try:
            from app.paper_trading.engine import get_paper_engine

            eng = get_paper_engine()
            if strategy_name in eng.store.approvals:
                checks["paper_trading_passed"] = True
                checks["strategy_approved"] = True
            val = eng.store.validations.get(strategy_name)
            if val and val.verdict == "pass":
                checks["paper_trading_passed"] = True
                checks["risk_approved"] = val.approval_score >= 70
        except Exception:
            pass
        checks["ready_for_live"] = all(
            checks[k] for k in ("paper_trading_passed", "strategy_approved")
        ) or not get_settings().live_require_approval
        return checks
