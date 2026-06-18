"""Phase 9 operations & n8n AI agent tests."""

import pytest

from app.core.config import get_settings
from app.memory.embeddings.service import get_embedding_service
from app.memory.qdrant.client import get_qdrant_store
from app.memory.service import get_memory_service
from app.operations.engine import get_operations_engine
from app.operations.tools.registry import ToolRegistry
from app.operations.types import ChatRequest


@pytest.fixture(autouse=True)
def ops_env(monkeypatch):
    monkeypatch.setenv("QDRANT_URL", ":memory:")
    monkeypatch.setenv("MEMORY_EMBEDDING_PROVIDER", "hash")
    monkeypatch.setenv("LIVE_DRY_RUN", "true")
    monkeypatch.setenv("LIVE_REQUIRE_APPROVAL", "false")
    get_settings.cache_clear()
    get_operations_engine.cache_clear()
    get_qdrant_store.cache_clear()
    get_embedding_service.cache_clear()
    get_memory_service.cache_clear()
    yield
    get_operations_engine.cache_clear()
    get_settings.cache_clear()


class TestToolRegistry:
    @pytest.mark.asyncio
    async def test_system_health(self):
        result = await ToolRegistry().execute("system_health")
        assert "summary" in result
        assert "paper" in result

    @pytest.mark.asyncio
    async def test_search_strategies(self):
        result = await ToolRegistry().execute("search_strategies")
        assert "summary" in result


class TestCoordinator:
    @pytest.mark.asyncio
    async def test_chat_without_llm(self):
        eng = get_operations_engine()
        resp = await eng.chat(ChatRequest(message="How many trades were opened today?", channel="test"))
        assert resp.answer
        assert resp.conversation_id
        assert len(resp.tool_calls) >= 1

    @pytest.mark.asyncio
    async def test_telegram_help(self):
        eng = get_operations_engine()
        answer = await eng.handle_telegram_command("/help")
        assert "/performance" in answer


@pytest.mark.asyncio
async def test_operations_api():
    from httpx import ASGITransport, AsyncClient
    from app.main import create_app

    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/agent/chat", json={"message": "Show system health", "channel": "test"})
        assert r.status_code == 200
        assert "answer" in r.json()

        status = await ac.get("/operations/status")
        assert status.status_code == 200

        dash = await ac.get("/operations/dashboard")
        assert dash.status_code == 200
        assert "tools" in dash.json()


@pytest.mark.asyncio
async def test_workflow_run():
    eng = get_operations_engine()
    run = await eng.workflows.run_workflow("health_check")
    assert run.status == "completed"


@pytest.mark.asyncio
async def test_report_generation():
    eng = get_operations_engine()
    task = await eng.run_task("report", {"report_type": "daily"})
    assert task.status == "completed"
    assert "report_id" in task.result
