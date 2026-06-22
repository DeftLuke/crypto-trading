"""CP0 tests — institutional SMC foundation contracts."""

from __future__ import annotations

import pytest

from app.institutional_smc.constants import (
    INSTITUTIONAL_ENGINE_VERSION,
    MIN_TRADE_SCORE,
    MTF_ROLES,
    RAW_SCORE_MAX,
    SCORE_WEIGHTS,
    RejectionCode,
    normalize_confluence_score,
)
from app.institutional_smc.orchestrator import InstitutionalSmcOrchestrator, MODULE_ROADMAP
from app.institutional_smc.types import SetupStatus
import polars as pl


def test_score_weights_raw_sum_and_normalization():
    assert RAW_SCORE_MAX == 110.0
    assert SCORE_WEIGHTS.total == 110.0
    assert normalize_confluence_score(110.0) == 100.0
    assert normalize_confluence_score(88.0) == 80.0


def test_min_trade_score_is_80():
    assert MIN_TRADE_SCORE == 80.0


def test_mtf_roles_match_spec():
    assert MTF_ROLES["trend"] == "1d"
    assert MTF_ROLES["bias"] == "4h"
    assert MTF_ROLES["setup"] == "1h"
    assert MTF_ROLES["entry"] == "15m"


def test_engine_version_v2():
    assert INSTITUTIONAL_ENGINE_VERSION == "v2"


def test_orchestrator_spec():
    orch = InstitutionalSmcOrchestrator()
    spec = orch.get_spec()
    assert spec["engine_version"] == "v2"
    assert spec["min_trade_score"] == 80
    assert spec["e5_superseded"] is True
    assert "structure" in spec["modules_implemented"]
    assert spec["module_roadmap"]["structure"] == "done"


def test_orchestrator_spec_cp6():
    orch = InstitutionalSmcOrchestrator()
    spec = orch.get_spec()
    assert spec["engine_version"] == "v2"
    assert spec["phase"] == "CP6"
    assert "node_integration" in spec["modules_implemented"]
    assert spec["modules_pending"] == []


@pytest.mark.asyncio
async def test_orchestrator_analyze_with_mock_candles(monkeypatch):
    from app.institutional_smc.orchestrator import InstitutionalSmcOrchestrator
    from app.institutional_smc.types import SetupStatus

    df = pl.DataFrame({
        "ts": [1_700_000_000_000 + i * 86_400_000 for i in range(120)],
        "open": [100 + i * 0.2 for i in range(120)],
        "high": [100.5 + i * 0.2 for i in range(120)],
        "low": [99.5 + i * 0.2 for i in range(120)],
        "close": [100.2 + i * 0.2 for i in range(120)],
        "volume": [1000.0] * 120,
    })

    async def fake_fetch(_exchange, _symbol, timeframes):
        return {tf: df for tf in timeframes}

    monkeypatch.setattr(
        "app.institutional_smc.orchestrator.fetch_mtf_candles",
        fake_fetch,
    )

    orch = InstitutionalSmcOrchestrator()
    result = await orch.analyze_async("BTCUSDT")
    assert result.status == SetupStatus.REJECTED
    assert result.explanation.market_structure.get("status") == "pass"
    assert "structure" in result.modules_implemented
    assert "liquidity" in result.modules_implemented
    assert "sweeps" in result.modules_implemented
    assert "order_blocks" in result.modules_implemented
    assert "fvg" in result.modules_implemented
    assert result.explanation.liquidity_sweep is not None
    assert result.explanation.order_block is not None
    assert result.explanation.fvg is not None
    assert result.explanation.premium_discount is not None
    assert result.explanation.displacement is not None
    assert len(result.explanation.filters) >= 5
    assert result.confluence_breakdown.ema_alignment >= 0
    assert result.confluence_score >= 0


@pytest.mark.asyncio
async def test_orchestrator_batch_mocked(monkeypatch):
    df = pl.DataFrame({
        "ts": [1_700_000_000_000 + i * 86_400_000 for i in range(100)],
        "open": [100 + i * 0.1 for i in range(100)],
        "high": [100.4 + i * 0.1 for i in range(100)],
        "low": [99.6 + i * 0.1 for i in range(100)],
        "close": [100.2 + i * 0.1 for i in range(100)],
        "volume": [500.0] * 100,
    })

    async def fake_fetch(_exchange, _symbol, timeframes):
        return {tf: df for tf in timeframes}

    monkeypatch.setattr(
        "app.institutional_smc.orchestrator.fetch_mtf_candles",
        fake_fetch,
    )

    orch = InstitutionalSmcOrchestrator()
    results = await orch.analyze_batch_async(["BTCUSDT", "ETHUSDT"])
    assert len(results) == 2
    assert all(r.status == SetupStatus.REJECTED for r in results)
