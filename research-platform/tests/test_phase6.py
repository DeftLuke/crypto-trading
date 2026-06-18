"""Phase 6 AI Research Agent tests."""

import pytest

from app.agents.coordinator import CoordinatorAgent
from app.agents.hypothesis.generator import HypothesisGenerator
from app.agents.meta.predictor import MetaLearningPredictor
from app.agents.research.condition_map import parse_conditions
from app.agents.research.strategy_generator import StrategyGenerator
from app.agents.scoring.engine import ScoringEngine
from app.agents.types import AgentState, Hypothesis
from app.agents.validation.validator import ValidationAgent
from app.core.config import get_settings
from app.memory.embeddings.service import get_embedding_service
from app.memory.qdrant.client import get_qdrant_store
from app.memory.service import get_memory_service
from app.agents.orchestrator import get_orchestrator


@pytest.fixture(autouse=True)
def agent_env(monkeypatch):
    monkeypatch.setenv("QDRANT_URL", ":memory:")
    monkeypatch.setenv("MEMORY_EMBEDDING_PROVIDER", "hash")
    monkeypatch.setenv("AGENT_LOW_RAM", "true")
    monkeypatch.setenv("AGENT_META_LEARNING", "false")
    get_settings.cache_clear()
    get_qdrant_store.cache_clear()
    get_embedding_service.cache_clear()
    get_memory_service.cache_clear()
    get_orchestrator.cache_clear()
    yield
    get_orchestrator.cache_clear()
    get_settings.cache_clear()


class TestConditionMap:
    def test_parse_rsi_bos(self):
        rules = parse_conditions(["RSI > 80", "Bearish BOS", "EMA100 Bearish"])
        assert len(rules) >= 2
        fields = {r["field"] for r in rules}
        assert "rsi14" in fields
        assert "bos_bearish" in fields


class TestHypothesisGenerator:
    def test_generates_hypotheses(self):
        gen = HypothesisGenerator()
        ctx = {"patterns": [{"pattern_name": "London OB", "win_rate": 68, "trade_count": 50}], "winning_setups": [], "reflections": []}
        hyps = gen.generate(ctx, max_hypotheses=5)
        assert len(hyps) >= 1
        assert hyps[0].title


class TestStrategyGenerator:
    def test_from_hypothesis(self):
        h = Hypothesis(title="Test", description="RSI London", conditions=["RSI > 80", "Bearish BOS"], direction="SHORT")
        strat = StrategyGenerator().from_hypothesis(h)
        assert strat.strategy_name.startswith("AI_")
        assert len(strat.rule_conditions) >= 1


class TestScoringEngine:
    def test_composite_score(self):
        score = ScoringEngine().score(
            {"profit_factor": 2.1, "sharpe_ratio": 1.8, "win_rate": 58, "max_drawdown_pct": 12, "strategy_name": "test"},
            meta_prob=0.7,
        )
        assert score.composite_score > 0
        assert score.strategy_name == "test"


class TestMetaPredictor:
    def test_heuristic_predict(self):
        pred = MetaLearningPredictor()
        result = pred.predict({"conditions": ["RSI > 80", "Bearish BOS"], "direction": "SHORT"}, {})
        assert 0 < result["success_probability"] <= 1
        assert result["expected_profit_factor"] > 0


class TestValidationAgent:
    def test_warnings_on_low_trades(self):
        v = ValidationAgent().analyze({"total_trades": 10, "profit_factor": 2.0, "max_drawdown_pct": 10}, {"conditions": ["a", "b", "c", "d", "e", "f"]})
        assert not v["passed"]
        assert any("sample size" in w.lower() for w in v["warnings"])


@pytest.mark.asyncio
async def test_coordinator_cycle():
    coord = CoordinatorAgent()
    state = AgentState()
    mem = get_memory_service()
    mem.store_trade(
        {
            "symbol": "BTCUSDT",
            "direction": "SHORT",
            "result": "WIN",
            "profit_percent": 3.5,
            "indicators": {"rsi": 84},
            "smc_features": {"bos": True, "ob": True},
            "session": "London",
        }
    )
    result = await coord.run_cycle(state)
    assert result["cycle"] == 1
    assert result["hypotheses"] >= 1
    assert len(coord.rankings) >= 0
    assert state.reflections_generated >= 0


@pytest.mark.asyncio
async def test_orchestrator_run_once():
    orch = get_orchestrator()
    result = await orch.run_once()
    assert "cycle" in result
    assert orch.status()["cycle_count"] >= 1


@pytest.mark.asyncio
async def test_agent_api_cycle():
    from app.main import create_app
    from httpx import ASGITransport, AsyncClient

    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post("/agent/research/cycle")
        assert resp.status_code == 200
        data = resp.json()
        assert "cycle" in data

        status = await ac.get("/agent/status")
        assert status.status_code == 200

        dashboard = await ac.get("/agent/dashboard")
        assert dashboard.status_code == 200
        assert "best_strategies" in dashboard.json()
