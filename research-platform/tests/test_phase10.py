"""Phase 10 enterprise control center tests."""

import pytest

from app.control_center.approval import ApprovalEngine
from app.control_center.engine import get_control_center
from app.control_center.types import TradingMode
from app.core.config import get_settings


@pytest.fixture(autouse=True)
def control_env(monkeypatch):
    monkeypatch.setenv("QDRANT_URL", ":memory:")
    monkeypatch.setenv("MEMORY_EMBEDDING_PROVIDER", "hash")
    monkeypatch.setenv("LIVE_DRY_RUN", "true")
    monkeypatch.setenv("LIVE_REQUIRE_APPROVAL", "false")
    monkeypatch.setenv("CONTROL_TRADING_MODE", "demo")
    monkeypatch.setenv("CONTROL_AUTO_TRADING", "true")
    monkeypatch.setenv("CONTROL_MANUAL_APPROVAL", "false")
    monkeypatch.setenv("TRADE_APPROVAL_PASSCODE", "8888")
    monkeypatch.setenv("PAPER_MAX_POSITIONS", "50")
    monkeypatch.setenv("PAPER_MAX_EXPOSURE_PCT", "99")
    get_settings.cache_clear()
    get_control_center.cache_clear()
    from app.paper_trading.engine import get_paper_engine
    get_paper_engine.cache_clear()
    yield
    get_control_center.cache_clear()
    get_paper_engine.cache_clear()
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_signal_pipeline_demo():
    cc = get_control_center()
    cc.store.settings.mode = TradingMode.DEMO
    cc.store.settings.auto_trading = True
    cc.store.settings.manual_approval = False
    from app.paper_trading.market_data.feed import get_market_feed
    get_market_feed().set_price("BTCUSDT", 100000)

    result = await cc.pipeline.process_signal({
        "symbol": "BTCUSDT", "direction": "SHORT", "entry": 100000,
        "sl": 101000, "tp1": 99000, "strategy_name": "manual",
    })
    assert result.get("executed") or result.get("accepted")


@pytest.mark.asyncio
async def test_manual_approval_flow():
    cc = get_control_center()
    cc.store.settings.auto_trading = True
    cc.store.settings.manual_approval = True
    from app.paper_trading.market_data.feed import get_market_feed
    get_market_feed().set_price("ETHUSDT", 3000)

    pending = await cc.pipeline.process_signal({
        "symbol": "ETHUSDT", "direction": "SHORT", "entry": 3000, "strategy_name": "manual",
    })
    assert pending.get("approval_required")
    aid = pending["approval_id"]

    bad = await cc.pipeline.approve_and_execute(aid, "wrong")
    assert not bad.get("executed")

    good = await cc.pipeline.approve_and_execute(aid, "8888")
    assert cc.store.approvals[aid].status == "approved"
    assert "executed" in good or "accepted" in good or "reason" in good


@pytest.mark.asyncio
async def test_auto_trading_off_notifies_only():
    cc = get_control_center()
    cc.store.settings.auto_trading = False
    result = await cc.pipeline.process_signal({"symbol": "ETHUSDT", "direction": "LONG", "entry": 3000})
    assert not result.get("executed")
    assert result.get("notified") or result.get("reason") == "auto_trading_off"


@pytest.mark.asyncio
async def test_control_api():
    from httpx import ASGITransport, AsyncClient
    from app.main import create_app

    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        dash = await ac.get("/control/dashboard")
        assert dash.status_code == 200
        assert "services" in dash.json()

        settings = await ac.get("/control/settings")
        assert settings.status_code == 200

        exchanges = await ac.get("/control/exchanges")
        assert exchanges.status_code == 200
        assert "binance" in exchanges.json()["supported"]

        audit = await ac.get("/control/audit")
        assert audit.status_code == 200


@pytest.mark.asyncio
async def test_service_registry():
    cc = get_control_center()
    services = await cc.services.refresh()
    assert len(services) >= 5
    names = {s.service_id for s in services}
    assert "paper_trading" in names
    assert "live_trading" in names
