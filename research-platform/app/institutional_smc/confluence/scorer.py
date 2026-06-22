"""CP5 confluence scorer and ≥80 acceptance gate."""

from __future__ import annotations

from dataclasses import dataclass

from app.institutional_smc.constants import MANDATORY_EXPLANATION_KEYS, MIN_TRADE_SCORE, RejectionCode
from app.institutional_smc.filters.validation import ValidationSnapshot
from app.institutional_smc.types import ConfluenceBreakdown, ModuleStatus, SetupStatus, TradeSetupExplanation


@dataclass
class GateResult:
    status: SetupStatus
    rejection_codes: list[str]
    rejection_reasons: list[str]
    explainability_complete: bool


class ConfluenceScorer:
    """Merge SMC module scores with validation filters and apply institutional gate."""

    def merge_breakdown(
        self,
        smc: ConfluenceBreakdown,
        validation: ValidationSnapshot,
    ) -> ConfluenceBreakdown:
        return ConfluenceBreakdown(
            market_structure=smc.market_structure,
            liquidity_sweep=smc.liquidity_sweep,
            order_block=smc.order_block,
            fvg=smc.fvg,
            premium_discount=smc.premium_discount,
            displacement=smc.displacement,
            volume_oi=validation.volume_oi,
            ema_alignment=validation.ema_alignment,
            rsi_macd=validation.rsi_macd,
            volatility=validation.volatility,
        )

    def evaluate_gate(
        self,
        *,
        direction: str,
        normalized_score: float,
        mtf_aligned: bool,
        explanation: TradeSetupExplanation,
        validation: ValidationSnapshot,
    ) -> GateResult:
        codes: list[str] = []
        reasons: list[str] = []

        explainability_ok = explanation.explainability_complete(MANDATORY_EXPLANATION_KEYS)
        if not explainability_ok:
            codes.append(RejectionCode.EXPLAINABILITY_INCOMPLETE)
            reasons.append("Mandatory explanation sections incomplete")

        if direction == "IGNORE":
            codes.append(RejectionCode.REGIME_RANGE)
            reasons.append("No actionable trade direction inferred")

        for f in validation.filters:
            if f.status == ModuleStatus.FAIL:
                from app.institutional_smc.filters.validation import FILTER_REJECTION_CODES
                code = FILTER_REJECTION_CODES.get(f.name)
                if code and code not in codes:
                    codes.append(code)
                    reasons.append(f"{f.name}: {f.reason}")

        if normalized_score < MIN_TRADE_SCORE:
            if RejectionCode.SCORE_BELOW_MIN not in codes:
                codes.append(RejectionCode.SCORE_BELOW_MIN)
            reasons.append(
                f"Normalized score {normalized_score:.1f} below minimum {MIN_TRADE_SCORE}",
            )

        if codes:
            return GateResult(
                status=SetupStatus.REJECTED,
                rejection_codes=codes,
                rejection_reasons=reasons,
                explainability_complete=explainability_ok,
            )

        return GateResult(
            status=SetupStatus.ACCEPTED,
            rejection_codes=[],
            rejection_reasons=[],
            explainability_complete=explainability_ok,
        )
