from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app


@pytest.fixture
def app():
    return create_app()


@pytest.fixture
async def client(app):
    mock_session = AsyncMock()
    mock_session.execute = AsyncMock(return_value=MagicMock(scalars=MagicMock(return_value=MagicMock(all=MagicMock(return_value=[])))))
    mock_session.commit = AsyncMock()
    mock_session.rollback = AsyncMock()
    mock_session.flush = AsyncMock()
    mock_session.add = MagicMock()

    async def override_get_db():
        yield mock_session

    from app.database.session import get_db

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_health_endpoint(client):
    with patch("app.api.routes.ParquetStorage") as mock_store, patch(
        "app.api.routes.ping_redis", new_callable=AsyncMock, return_value=True
    ):
        mock_store.return_value.storage_stats.return_value = {"file_count": 0, "total_mb": 0}
        resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] in ("healthy", "degraded")
    assert data["service"] == "research-platform"


@pytest.mark.asyncio
async def test_symbols_list(client):
    resp = await client.get("/symbols")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
