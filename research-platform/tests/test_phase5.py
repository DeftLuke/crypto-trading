"""Phase 5 memory layer tests."""

import os
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings
from app.memory.owm import apply_outcome
from app.memory.retrieval.ranking import compute_memory_rank, rank_results
from app.memory.reflections.engine import ReflectionEngine
from app.memory.evolution.pattern_discovery import PatternDiscovery
from app.memory.types import MemoryWeights
from app.memory.service import MemoryService
from app.memory.qdrant.client import get_qdrant_store
from app.memory.embeddings.service import get_embedding_service
from app.memory.service import get_memory_service


@pytest.fixture(autouse=True)
def memory_env(monkeypatch):
    monkeypatch.setenv("QDRANT_URL", ":memory:")
    monkeypatch.setenv("MEMORY_EMBEDDING_PROVIDER", "hash")
    monkeypatch.setenv("MEMORY_VECTOR_SIZE", "384")
    monkeypatch.setenv("MEMORY_ENABLED", "true")
    get_settings.cache_clear()
    get_qdrant_store.cache_clear()
    get_embedding_service.cache_clear()
    get_memory_service.cache_clear()
    yield
    get_qdrant_store.cache_clear()
    get_embedding_service.cache_clear()
    get_memory_service.cache_clear()
    get_settings.cache_clear()


@pytest.fixture
def svc():
    return MemoryService()


class TestOWM:
    def test_win_increases_weight(self):
        w = MemoryWeights(memory_weight=1.0, success_score=0.5)
        updated = apply_outcome(w, "WIN", 3.5)
        assert updated.memory_weight > 1.0
        assert updated.success_score > 0.5

    def test_loss_decreases_weight(self):
        w = MemoryWeights(memory_weight=1.0, success_score=0.5)
        updated = apply_outcome(w, "LOSS", -2.0)
        assert updated.memory_weight < 1.0
        assert updated.success_score < 0.5


class TestRanking:
    def test_compute_memory_rank(self):
        payload = {
            "created_at": "2026-06-01T00:00:00+00:00",
            "result": "WIN",
            "profit_percent": 3.5,
            "weights": {"memory_weight": 1.5, "success_score": 0.8, "confidence_score": 0.7, "usage_count": 5},
        }
        rank = compute_memory_rank(payload, similarity_score=0.9)
        assert 0 < rank <= 1.0

    def test_rank_results_orders_descending(self):
        results = [
            {"memory_id": "a", "similarity_score": 0.5, "result": "LOSS"},
            {"memory_id": "b", "similarity_score": 0.9, "result": "WIN", "profit_percent": 5},
        ]
        ranked = rank_results(results)
        assert ranked[0]["memory_rank"] >= ranked[1]["memory_rank"]


class TestReflectionEngine:
    def test_generates_trade_reflection(self):
        engine = ReflectionEngine()
        ref = engine.generate_trade_reflection(
            {
                "symbol": "BTCUSDT",
                "direction": "SHORT",
                "result": "WIN",
                "rsi": 84,
                "session": "London",
                "smc_features": {"bos": True, "ob": True, "liquidity_sweep": True},
            }
        )
        assert "BOS" in ref.observation
        assert ref.confidence > 0.5


class TestPatternDiscovery:
    def test_discovers_patterns(self):
        trades = []
        for i in range(8):
            trades.append(
                {
                    "direction": "SHORT",
                    "session": "London",
                    "result": "WIN" if i < 6 else "LOSS",
                    "profit_percent": 2.0 if i < 6 else -1.0,
                    "smc_features": {"bos": True, "ob": True},
                    "indicators": {"rsi": 85},
                }
            )
        patterns = PatternDiscovery().discover_from_trades(trades)
        assert len(patterns) >= 1
        assert patterns[0].win_rate is not None


class TestMemoryService:
    def test_store_and_search_trade(self, svc):
        stored = svc.store_trade(
            {
                "symbol": "BTCUSDT",
                "direction": "SHORT",
                "timeframe": "15m",
                "result": "WIN",
                "profit_percent": 3.8,
                "indicators": {"rsi": 84},
                "smc_features": {"bos": True, "ob": True, "liquidity_sweep": True},
                "session": "London",
            }
        )
        assert stored["memory_id"]
        results = svc.search("BTCUSDT bearish BOS order block RSI", "trade_memories", limit=5)
        assert len(results) >= 1

    def test_trade_recall(self, svc):
        svc.store_trade(
            {
                "symbol": "BTCUSDT",
                "direction": "SHORT",
                "result": "WIN",
                "profit_percent": 4.0,
                "indicators": {"rsi": 83},
                "smc_features": {"bos": True, "ob": True},
            }
        )
        svc.store_trade(
            {
                "symbol": "BTCUSDT",
                "direction": "SHORT",
                "result": "WIN",
                "profit_percent": 2.5,
                "indicators": {"rsi": 81},
                "smc_features": {"bos": True, "liquidity_sweep": True},
            }
        )
        recall = svc.recall(
            {
                "symbol": "BTCUSDT",
                "direction": "SHORT",
                "rsi": 83,
                "smc_features": {"bos": True, "ob": True},
            }
        )
        assert recall["count"] >= 1
        assert "win_rate" in recall
        assert recall["confidence"] > 0

    def test_learning_cycle(self, svc):
        for i in range(6):
            svc.store_trade(
                {
                    "symbol": "ETHUSDT",
                    "direction": "LONG",
                    "result": "WIN" if i % 2 == 0 else "LOSS",
                    "profit_percent": 1.5 if i % 2 == 0 else -0.8,
                    "smc_features": {"bos": True},
                    "session": "Asian",
                }
            )
        result = svc.run_learning_cycle()
        assert result["trades_analyzed"] >= 6
        assert result["patterns_discovered"] >= 0

    def test_stats(self, svc):
        svc.store_signal({"symbol": "BTCUSDT", "direction": "LONG", "confidence": 85})
        stats = svc.stats()
        assert stats["total_memories"] >= 1
        assert "signal_memories" in stats["collections"]


@pytest.fixture
async def api_client(memory_env):
    from app.main import create_app

    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_memory_api_store_and_recall(api_client):
    trade = {
        "symbol": "BTCUSDT",
        "direction": "SHORT",
        "timeframe": "15m",
        "result": "WIN",
        "profit_percent": 3.8,
        "indicators": {"rsi": 84},
        "smc_features": {"bos": True, "ob": True},
        "session": "London",
    }
    resp = await api_client.post("/memory/trade", json=trade)
    assert resp.status_code == 200
    assert resp.json()["memory_id"]

    recall = await api_client.post(
        "/memory/recall",
        json={"symbol": "BTCUSDT", "direction": "SHORT", "rsi": 84, "smc_features": {"bos": True}},
    )
    assert recall.status_code == 200
    data = recall.json()
    assert data["count"] >= 1

    stats = await api_client.get("/memory/stats")
    assert stats.status_code == 200
    assert stats.json()["total_memories"] >= 1

    dashboard = await api_client.get("/memory/dashboard")
    assert dashboard.status_code == 200
    assert "learning_progress" in dashboard.json()
