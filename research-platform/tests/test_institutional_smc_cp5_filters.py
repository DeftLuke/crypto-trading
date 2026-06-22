"""CP5 tests — validation filters + confluence gate."""

from __future__ import annotations

import polars as pl

from app.institutional_smc.confluence.scorer import ConfluenceScorer
from app.institutional_smc.constants import MIN_TRADE_SCORE, RejectionCode, normalize_confluence_score
from app.institutional_smc.filters.validation import ValidationFilterEngine
from app.institutional_smc.modules.premium_discount import PremiumDiscountEngine, PriceZone
from app.institutional_smc.types import ConfluenceBreakdown, FilterResult, ModuleStatus, SetupStatus, TradeSetupExplanation


def _uptrend_entry(n: int = 250) -> pl.DataFrame:
    rows = []
    price = 100.0
    for i in range(n):
        ts = 1_700_000_000_000 + i * 900_000
        price += 0.08
        rows.append({
            "ts": ts,
            "open": price - 0.05,
            "high": price + 0.15,
            "low": price - 0.12,
            "close": price,
            "volume": 1500.0 + (i % 5) * 200,
        })
    rows[-1]["volume"] = 5000.0
    return pl.DataFrame(rows)


def _discount_bars() -> pl.DataFrame:
    rows = []
    for i in range(80):
        ts = 1_700_000_000_000 + i * 3_600_000
        rows.append({
            "ts": ts, "open": 100.0, "high": 110.0, "low": 90.0, "close": 100.0, "volume": 1000.0,
        })
    rows[-1] = {**rows[-1], "open": 93.0, "high": 94.0, "low": 92.0, "close": 92.5, "volume": 2000.0}
    return pl.DataFrame(rows)


def test_validation_ema_rsi_pass_long():
    df = _uptrend_entry()
    pd_snap = PremiumDiscountEngine().analyze(_discount_bars(), "4h")
    snap = ValidationFilterEngine().evaluate(
        "LONG",
        mtf_aligned=True,
        setup_df=df,
        entry_df=df,
        pd_snap=pd_snap,
    )
    names = {f.name for f in snap.filters}
    assert "ema_alignment" in names
    assert "rsi" in names
    assert "macd" in names
    ema = next(f for f in snap.filters if f.name == "ema_alignment")
    assert ema.status in (ModuleStatus.PASS, ModuleStatus.PARTIAL)


def test_validation_htf_fail():
    snap = ValidationFilterEngine().evaluate(
        "LONG",
        mtf_aligned=False,
        setup_df=_uptrend_entry(),
        entry_df=_uptrend_entry(),
    )
    htf = next(f for f in snap.filters if f.name == "htf_alignment")
    assert htf.status == ModuleStatus.FAIL
    assert RejectionCode.HTF_MISALIGNMENT in snap.hard_fail_codes


def test_validation_rsi_fail_short_on_uptrend():
    df = _uptrend_entry()
    snap = ValidationFilterEngine().evaluate(
        "SHORT",
        mtf_aligned=True,
        setup_df=df,
        entry_df=df,
    )
    rsi = next(f for f in snap.filters if f.name == "rsi")
    assert rsi.status == ModuleStatus.FAIL


def test_confluence_scorer_merge_includes_filters():
    smc = ConfluenceBreakdown(market_structure=15.0, liquidity_sweep=12.0)
    validation = ValidationFilterEngine().evaluate(
        "LONG",
        mtf_aligned=True,
        setup_df=_uptrend_entry(),
        entry_df=_uptrend_entry(),
    )
    merged = ConfluenceScorer().merge_breakdown(smc, validation)
    assert merged.ema_alignment >= 0
    assert merged.rsi_macd >= 0
    assert merged.total > smc.total


def test_gate_rejects_below_min_score():
    breakdown = ConfluenceBreakdown(market_structure=10.0, liquidity_sweep=8.0)
    normalized = normalize_confluence_score(breakdown.total)
    validation = ValidationFilterEngine().evaluate(
        "LONG",
        mtf_aligned=True,
        setup_df=_uptrend_entry(),
        entry_df=_uptrend_entry(),
    )
    explanation = TradeSetupExplanation(
        market_structure={"status": "pass"},
        liquidity_sweep={"status": "pass"},
        order_block={"status": "not_detected"},
        fvg={"status": "not_detected"},
        premium_discount={"status": "pass"},
        displacement={"status": "not_detected"},
        filters=validation.filters,
        confluence=breakdown,
    )
    gate = ConfluenceScorer().evaluate_gate(
        direction="LONG",
        normalized_score=normalized,
        mtf_aligned=True,
        explanation=explanation,
        validation=validation,
    )
    assert gate.status == SetupStatus.REJECTED
    assert RejectionCode.SCORE_BELOW_MIN in gate.rejection_codes
    assert normalized < MIN_TRADE_SCORE


def test_gate_accepts_strong_setup():
    smc = ConfluenceBreakdown(
        market_structure=18.0,
        liquidity_sweep=18.0,
        order_block=10.0,
        fvg=8.0,
        premium_discount=7.0,
        displacement=9.0,
    )
    validation = ValidationSnapshotStub(
        ema_alignment=9.0,
        rsi_macd=4.5,
        volatility=4.5,
        volume_oi=8.0,
        filters=[FilterResult(name="htf_alignment", status=ModuleStatus.PASS, reason="aligned")],
    )
    breakdown = ConfluenceScorer().merge_breakdown(smc, validation)
    normalized = normalize_confluence_score(breakdown.total)
    explanation = TradeSetupExplanation(
        market_structure={"status": "pass"},
        liquidity_sweep={"status": "pass"},
        order_block={"status": "pass"},
        fvg={"status": "pass"},
        premium_discount={"status": "pass"},
        displacement={"status": "pass"},
        filters=validation.filters,
        confluence=breakdown,
    )
    gate = ConfluenceScorer().evaluate_gate(
        direction="LONG",
        normalized_score=normalized,
        mtf_aligned=True,
        explanation=explanation,
        validation=validation,
    )
    assert normalized >= MIN_TRADE_SCORE
    assert gate.status == SetupStatus.ACCEPTED
    assert gate.rejection_codes == []


class ValidationSnapshotStub:
    def __init__(self, **kwargs) -> None:
        self.ema_alignment = kwargs.get("ema_alignment", 0.0)
        self.rsi_macd = kwargs.get("rsi_macd", 0.0)
        self.volatility = kwargs.get("volatility", 0.0)
        self.volume_oi = kwargs.get("volume_oi", 0.0)
        self.filters = kwargs.get("filters", [])

    @property
    def hard_fail_codes(self) -> list[str]:
        return []
