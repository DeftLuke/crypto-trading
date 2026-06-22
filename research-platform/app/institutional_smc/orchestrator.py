"""Institutional SMC orchestrator — CP1–CP5 full scoring gate."""

from __future__ import annotations

from dataclasses import asdict

from sqlalchemy.ext.asyncio import AsyncSession

from app.institutional_smc.confluence.scorer import ConfluenceScorer
from app.institutional_smc.constants import (
    INSTITUTIONAL_ENGINE_VERSION,
    MIN_TRADE_SCORE,
    MTF_ROLES,
    RejectionCode,
    SCORE_WEIGHTS,
    normalize_confluence_score,
)
from app.institutional_smc.data.candle_provider import fetch_mtf_candles
from app.institutional_smc.filters.validation import ValidationFilterEngine
from app.institutional_smc.modules.displacement import DisplacementEngine, DisplacementSnapshot
from app.institutional_smc.modules.fvg import FVGEngine, FVGSnapshot
from app.institutional_smc.modules.liquidity import LiquidityEngine, LiquiditySnapshot
from app.institutional_smc.modules.order_blocks import OrderBlockEngine, OrderBlockSnapshot
from app.institutional_smc.modules.premium_discount import PremiumDiscountEngine, PremiumDiscountSnapshot
from app.institutional_smc.modules.structure import MarketStructureEngine, MarketStructureSnapshot, StructureState
from app.institutional_smc.modules.sweeps import SweepEngine, SweepSnapshot
from app.institutional_smc.persistence.displacement_writer import persist_displacements
from app.institutional_smc.persistence.liquidity_writer import persist_liquidity_levels, persist_sweeps
from app.institutional_smc.persistence.structure_writer import persist_structure_events
from app.institutional_smc.persistence.zones_writer import persist_fvgs, persist_order_blocks
from app.institutional_smc.types import (
    ConfluenceBreakdown,
    ModuleStatus,
    SetupStatus,
    TradeSetupExplanation,
    TradeSetupResult,
    make_trade_setup_explanation,
)

MODULE_ROADMAP: dict[str, str] = {
    "structure": "done",
    "liquidity": "done",
    "sweeps": "done",
    "order_blocks": "done",
    "fvg": "done",
    "premium_discount": "done",
    "displacement": "done",
    "filters": "done",
    "confluence": "done",
    "persistence": "done",
    "node_integration": "done",
}

PENDING_MODULES = [k for k, v in MODULE_ROADMAP.items() if v != "done"]
IMPLEMENTED_MODULES = [k for k, v in MODULE_ROADMAP.items() if v == "done"]


class InstitutionalSmcOrchestrator:
    """Single entry point for institutional SMC analysis."""

    def __init__(self, exchange: str = "binance") -> None:
        self.exchange = exchange
        self.structure_engine = MarketStructureEngine()
        self.liquidity_engine = LiquidityEngine()
        self.sweep_engine = SweepEngine()
        self.ob_engine = OrderBlockEngine()
        self.fvg_engine = FVGEngine()
        self.pd_engine = PremiumDiscountEngine()
        self.displacement_engine = DisplacementEngine()
        self.validation_engine = ValidationFilterEngine()
        self.scorer = ConfluenceScorer()

    def get_spec(self) -> dict:
        return {
            "engine_version": INSTITUTIONAL_ENGINE_VERSION,
            "min_trade_score": MIN_TRADE_SCORE,
            "score_weights": asdict(SCORE_WEIGHTS),
            "mtf_roles": MTF_ROLES,
            "module_roadmap": MODULE_ROADMAP,
            "modules_implemented": IMPLEMENTED_MODULES,
            "modules_pending": PENDING_MODULES,
            "e5_superseded": True,
            "legacy_node_engine": "smc-mtf v1 — replaced at CP6",
            "phase": "CP6",
        }

    async def analyze_async(
        self,
        symbol: str,
        *,
        persist: bool = False,
        session: AsyncSession | None = None,
    ) -> TradeSetupResult:
        sym = symbol.upper()
        timeframes = list(MTF_ROLES.values())
        candles = await fetch_mtf_candles(
            self.exchange, sym, timeframes, session=session,
        )

        if not candles:
            return self._reject(
                sym,
                [RejectionCode.ENGINE_OFFLINE],
                ["Could not load candle data from exchange"],
                explanation=make_trade_setup_explanation(
                    market_structure={"status": ModuleStatus.FAIL.value, "reason": "no_candles"},
                    human_summary=f"{sym}: no candle data available",
                ),
            )

        daily_df = candles.get(MTF_ROLES["trend"])

        structure_snaps: dict[str, MarketStructureSnapshot] = {}
        liquidity_snaps: dict[str, LiquiditySnapshot] = {}
        sweep_snaps: dict[str, SweepSnapshot] = {}
        ob_snaps: dict[str, OrderBlockSnapshot] = {}
        fvg_snaps: dict[str, FVGSnapshot] = {}
        pd_snaps: dict[str, PremiumDiscountSnapshot] = {}
        disp_snaps: dict[str, DisplacementSnapshot] = {}
        mtf_structure: dict[str, dict] = {}

        for role, tf in MTF_ROLES.items():
            df = candles.get(tf)
            if df is None or df.is_empty():
                mtf_structure[role] = {"timeframe": tf, "status": "missing_data"}
                continue

            s_snap = self.structure_engine.analyze(df, timeframe=tf)
            structure_snaps[tf] = s_snap
            mtf_structure[role] = s_snap.to_explanation_dict()

            liq = self.liquidity_engine.analyze(df, timeframe=tf, daily_df=daily_df)
            liquidity_snaps[tf] = liq

            if role in ("bias", "setup"):
                pd_snaps[tf] = self.pd_engine.analyze(df, timeframe=tf)

            if role in ("setup", "entry"):
                sweep_snaps[tf] = self.sweep_engine.analyze(df, liq, timeframe=tf)
                ob_snaps[tf] = self.ob_engine.analyze(df, timeframe=tf, structure=s_snap)
                fvg_snaps[tf] = self.fvg_engine.analyze(df, timeframe=tf)
                disp_snaps[tf] = self.displacement_engine.analyze(df, timeframe=tf)

        if persist and session is not None:
            if structure_snaps:
                await persist_structure_events(session, self.exchange, sym, structure_snaps)
            if liquidity_snaps:
                await persist_liquidity_levels(session, self.exchange, sym, liquidity_snaps)
            if sweep_snaps:
                await persist_sweeps(session, self.exchange, sym, sweep_snaps)
            if ob_snaps:
                await persist_order_blocks(session, self.exchange, sym, ob_snaps)
            if fvg_snaps:
                await persist_fvgs(session, self.exchange, sym, fvg_snaps)
            if disp_snaps:
                await persist_displacements(session, self.exchange, sym, disp_snaps)

        trend_snap = structure_snaps.get(MTF_ROLES["trend"])
        bias_snap = structure_snaps.get(MTF_ROLES["bias"])
        setup_snap = structure_snaps.get(MTF_ROLES["setup"])
        entry_liq = liquidity_snaps.get(MTF_ROLES["entry"])
        setup_liq = liquidity_snaps.get(MTF_ROLES["setup"])
        entry_sweep = sweep_snaps.get(MTF_ROLES["entry"])
        setup_sweep = sweep_snaps.get(MTF_ROLES["setup"])
        setup_ob = ob_snaps.get(MTF_ROLES["setup"])
        entry_ob = ob_snaps.get(MTF_ROLES["entry"])
        setup_fvg = fvg_snaps.get(MTF_ROLES["setup"])
        entry_fvg = fvg_snaps.get(MTF_ROLES["entry"])
        bias_pd = pd_snaps.get(MTF_ROLES["bias"])
        setup_pd = pd_snaps.get(MTF_ROLES["setup"])
        setup_disp = disp_snaps.get(MTF_ROLES["setup"])
        entry_disp = disp_snaps.get(MTF_ROLES["entry"])
        setup_df = candles.get(MTF_ROLES["setup"])
        entry_df = candles.get(MTF_ROLES["entry"])

        inferred_direction = self._infer_direction(trend_snap, bias_snap, setup_snap, entry_sweep, setup_sweep)
        mtf_aligned = self._htf_aligned(trend_snap, bias_snap)

        raw_structure = setup_snap.structure_score_component(inferred_direction) if setup_snap else 0.0
        primary_sweep = entry_sweep or setup_sweep
        raw_sweep = primary_sweep.sweep_score_component(inferred_direction) if primary_sweep else 0.0
        primary_ob = entry_ob or setup_ob
        raw_ob = primary_ob.ob_score_component(inferred_direction) if primary_ob else 0.0
        primary_fvg = entry_fvg or setup_fvg
        raw_fvg = primary_fvg.fvg_score_component(inferred_direction) if primary_fvg else 0.0
        primary_pd = setup_pd or bias_pd
        raw_pd = primary_pd.pd_score_component(inferred_direction) if primary_pd else 0.0
        primary_disp = entry_disp or setup_disp
        raw_disp = primary_disp.displacement_score_component(inferred_direction) if primary_disp else 0.0

        smc_breakdown = ConfluenceBreakdown(
            market_structure=raw_structure,
            liquidity_sweep=raw_sweep,
            order_block=raw_ob,
            fvg=raw_fvg,
            premium_discount=raw_pd,
            displacement=raw_disp,
        )

        validation = self.validation_engine.evaluate(
            inferred_direction,
            mtf_aligned=mtf_aligned,
            setup_df=setup_df,
            entry_df=entry_df,
            pd_snap=primary_pd,
        )
        breakdown = self.scorer.merge_breakdown(smc_breakdown, validation)
        normalized = normalize_confluence_score(breakdown.total)

        structure_summary = mtf_structure.get("setup") or mtf_structure.get("bias") or {}
        liquidity_explanation = {
            "status": ModuleStatus.PASS.value,
            "setup": setup_liq.to_explanation_dict() if setup_liq else None,
            "entry": entry_liq.to_explanation_dict() if entry_liq else None,
        }
        sweep_explanation = {
            "status": ModuleStatus.PASS.value if primary_sweep and primary_sweep.last_sweep else ModuleStatus.NOT_DETECTED.value,
            "setup": setup_sweep.to_explanation_dict() if setup_sweep else None,
            "entry": entry_sweep.to_explanation_dict() if entry_sweep else None,
            "aligned_with_direction": raw_sweep >= 5.0,
        }
        ob_explanation = {
            "status": ModuleStatus.PASS.value if primary_ob and primary_ob.blocks else ModuleStatus.NOT_DETECTED.value,
            "setup": setup_ob.to_explanation_dict() if setup_ob else None,
            "entry": entry_ob.to_explanation_dict() if entry_ob else None,
            "aligned_with_direction": raw_ob >= 3.0,
        }
        fvg_explanation = {
            "status": ModuleStatus.PASS.value if primary_fvg and primary_fvg.gaps else ModuleStatus.NOT_DETECTED.value,
            "setup": setup_fvg.to_explanation_dict() if setup_fvg else None,
            "entry": entry_fvg.to_explanation_dict() if entry_fvg else None,
            "aligned_with_direction": raw_fvg >= 2.0,
        }
        pd_explanation = {
            "status": ModuleStatus.PASS.value if primary_pd and primary_pd.bar_count else ModuleStatus.NOT_DETECTED.value,
            "bias": bias_pd.to_explanation_dict() if bias_pd else None,
            "setup": setup_pd.to_explanation_dict() if setup_pd else None,
            "aligned_with_direction": raw_pd >= 2.0,
        }
        disp_explanation = {
            "status": ModuleStatus.PASS.value if primary_disp and primary_disp.last_displacement else ModuleStatus.NOT_DETECTED.value,
            "setup": setup_disp.to_explanation_dict() if setup_disp else None,
            "entry": entry_disp.to_explanation_dict() if entry_disp else None,
            "aligned_with_direction": raw_disp >= 2.0,
        }

        explanation = make_trade_setup_explanation(
            market_structure={
                "status": ModuleStatus.PASS.value,
                "mtf": mtf_structure,
                "htf_aligned": mtf_aligned,
                "inferred_direction": inferred_direction,
                **structure_summary,
            },
            liquidity_sweep={
                **sweep_explanation,
                "liquidity_levels": liquidity_explanation,
            },
            order_block=ob_explanation,
            fvg=fvg_explanation,
            premium_discount=pd_explanation,
            displacement=disp_explanation,
            filters=validation.filters,
            confluence=breakdown,
            mtf={**MTF_ROLES, "aligned": mtf_aligned},
        )

        gate = self.scorer.evaluate_gate(
            direction=inferred_direction,
            normalized_score=normalized,
            mtf_aligned=mtf_aligned,
            explanation=explanation,
            validation=validation,
        )
        explanation.human_summary = self._build_summary(
            sym, inferred_direction, structure_summary, primary_sweep, primary_ob,
            primary_fvg, primary_pd, primary_disp, normalized, gate.status,
        )

        entry_price = stop_loss = tp1 = tp2 = tp3 = None
        if gate.status == SetupStatus.ACCEPTED and inferred_direction != "IGNORE":
            entry_df = candles.get(MTF_ROLES["entry"])
            entry_close = float(entry_df["close"][-1]) if entry_df is not None and not entry_df.is_empty() else None
            levels = self._compute_trade_levels(inferred_direction, entry_close, entry_ob or setup_ob)
            if levels:
                entry_price, stop_loss, tp1, tp2, tp3 = levels

        return TradeSetupResult(
            symbol=sym,
            direction=inferred_direction or "IGNORE",
            status=gate.status,
            engine_version=INSTITUTIONAL_ENGINE_VERSION,
            confluence_score=normalized,
            confluence_breakdown=breakdown,
            explanation=explanation,
            rejection_codes=gate.rejection_codes,
            rejection_reasons=gate.rejection_reasons,
            entry_price=entry_price,
            stop_loss=stop_loss,
            tp1=tp1,
            tp2=tp2,
            tp3=tp3,
            mtf_aligned=mtf_aligned,
            modules_implemented=IMPLEMENTED_MODULES,
            modules_pending=PENDING_MODULES,
        )

    def analyze(self, symbol: str, *, persist: bool = False) -> TradeSetupResult:
        import asyncio
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if loop and loop.is_running():
            raise RuntimeError("Use analyze_async inside async context")
        return asyncio.run(self.analyze_async(symbol, persist=persist))

    async def analyze_batch_async(
        self,
        symbols: list[str],
        *,
        persist: bool = False,
        session: AsyncSession | None = None,
    ) -> list[TradeSetupResult]:
        return [
            await self.analyze_async(sym, persist=persist, session=session)
            for sym in symbols
        ]

    def _infer_direction(self, trend_snap, bias_snap, setup_snap, entry_sweep, setup_sweep) -> str:
        for sweep_snap in (entry_sweep, setup_sweep):
            if sweep_snap and sweep_snap.last_sweep:
                d = sweep_snap.last_sweep.sweep_direction.value
                if d == "buyside":
                    return "LONG"
                if d == "sellside":
                    return "SHORT"
        for snap in (setup_snap, bias_snap, trend_snap):
            if snap is None:
                continue
            if snap.structure_state == StructureState.BULLISH and snap.last_event:
                if snap.last_event.direction == "bullish":
                    return "LONG"
            if snap.structure_state == StructureState.BEARISH and snap.last_event:
                if snap.last_event.direction == "bearish":
                    return "SHORT"
        if trend_snap and trend_snap.structure_state == StructureState.BULLISH:
            return "LONG"
        if trend_snap and trend_snap.structure_state == StructureState.BEARISH:
            return "SHORT"
        return "IGNORE"

    def _htf_aligned(self, trend_snap, bias_snap) -> bool:
        if not trend_snap or not bias_snap:
            return False
        if trend_snap.structure_state == StructureState.RANGE:
            return False
        return trend_snap.structure_state == bias_snap.structure_state

    def _compute_trade_levels(self, direction: str, entry_price: float | None, ob_snap) -> tuple | None:
        if not entry_price or entry_price <= 0:
            return None
        ob = ob_snap.best_for_direction(direction) if ob_snap else None
        ob_high = ob.high if ob else entry_price * 1.005
        ob_low = ob.low if ob else entry_price * 0.995
        is_long = direction.upper() in ("LONG", "BUY")

        if is_long:
            stop_loss = ob_low * 0.999
            risk = entry_price - stop_loss
        else:
            stop_loss = ob_high * 1.001
            risk = stop_loss - entry_price
        if risk <= 0:
            risk = entry_price * 0.005

        if is_long:
            tp1 = entry_price + risk
            tp2 = entry_price + risk * 2
            tp3 = entry_price + risk * 3
        else:
            tp1 = entry_price - risk
            tp2 = entry_price - risk * 2
            tp3 = entry_price - risk * 3

        return (
            round(entry_price, 8),
            round(stop_loss, 8),
            round(tp1, 8),
            round(tp2, 8),
            round(tp3, 8),
        )

    def _build_summary(
        self, symbol, direction, structure_summary, sweep_snap, ob_snap, fvg_snap,
        pd_snap, disp_snap, score, status,
    ) -> str:
        state = structure_summary.get("structure_state", "unknown")
        sweep = sweep_snap.last_sweep.to_dict() if sweep_snap and sweep_snap.last_sweep else {}
        ob = ob_snap.best_for_direction(direction) if ob_snap else None
        gap = fvg_snap.best_for_direction(direction) if fvg_snap else None
        zone = pd_snap.zone.value if pd_snap else "unknown"
        disp = disp_snap.last_displacement.to_dict() if disp_snap and disp_snap.last_displacement else {}
        verdict = status.value if hasattr(status, "value") else str(status)
        return (
            f"{symbol} CP6 [{verdict}]: structure {state} · sweep {sweep.get('sweep_type', 'none')} "
            f"· OB {ob.direction.value if ob else 'none'} · FVG {gap.direction.value if gap else 'none'} "
            f"· zone {zone} · displacement {disp.get('direction', 'none')} "
            f"· direction {direction} · score {score:.1f}/{MIN_TRADE_SCORE}"
        )

    def _reject(
        self,
        symbol: str,
        codes: list[str],
        reasons: list[str],
        explanation: TradeSetupExplanation,
    ) -> TradeSetupResult:
        return TradeSetupResult(
            symbol=symbol,
            direction="IGNORE",
            status=SetupStatus.REJECTED,
            engine_version=INSTITUTIONAL_ENGINE_VERSION,
            confluence_score=0.0,
            confluence_breakdown=ConfluenceBreakdown(),
            explanation=explanation,
            rejection_codes=codes,
            rejection_reasons=reasons,
            mtf_aligned=False,
            modules_implemented=IMPLEMENTED_MODULES,
            modules_pending=PENDING_MODULES,
        )
