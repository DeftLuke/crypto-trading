"""Phase 8 live trading tests."""

import pytest

from app.core.config import get_settings
from app.live_trading.authorization.strategy_gate import StrategyGate
from app.live_trading.engine import get_live_engine
from app.live_trading.execution.leverage import leverage_fallback_chain
from app.live_trading.risk.engine import LiveRiskEngine
from app.live_trading.store import LiveStore
from app.live_trading.types import LiveAccount, LivePosition, LiveSignal
from app.paper_trading.market_data.feed import get_market_feed


@pytest.fixture(autouse=True)
def live_env(monkeypatch):
    monkeypatch.setenv("QDRANT_URL", ":memory:")
    monkeypatch.setenv("MEMORY_EMBEDDING_PROVIDER", "hash")
    monkeypatch.setenv("LIVE_DRY_RUN", "true")
    monkeypatch.setenv("LIVE_REQUIRE_APPROVAL", "false")
    monkeypatch.setenv("LIVE_ALLOW_MANUAL", "true")
    monkeypatch.setenv("LIVE_SIMULATED_LATENCY_MS", "0")
    get_settings.cache_clear()
    get_live_engine.cache_clear()
    yield
    get_live_engine.cache_clear()
    get_settings.cache_clear()


class TestLeverageFallback:
    def test_chain(self):
        chain = leverage_fallback_chain(50)
        assert chain[0] == 50
        assert 5 in chain


class TestStrategyGate:
    def test_manual_allowed(self):
        ok, reason = StrategyGate().is_authorized("manual", manual_override=True)
        assert ok
        assert reason in ("manual_override", "manual_allowed")


class TestLiveRiskEngine:
    def test_blocks_kill_switch(self):
        store = LiveStore()
        store.circuit.kill_switch = True
        acc = LiveAccount()
        store.accounts[acc.account_id] = acc
        risk = LiveRiskEngine(store)
        ok, reason = risk.validate_signal(acc.account_id, LiveSignal(symbol="BTCUSDT", direction="SHORT"))
        assert not ok
        assert "Kill switch" in reason


@pytest.mark.asyncio
async def test_live_open_and_close():
    eng = get_live_engine()
    feed = get_market_feed()
    feed.set_price("BTCUSDT", 100000)

    await eng.start()
    signal = LiveSignal(
        symbol="BTCUSDT",
        direction="SHORT",
        confidence=91,
        entry=100000,
        sl=101000,
        tp1=99000,
        strategy_name="manual",
        manual_override=True,
    )
    result = await eng.process_signal(signal)
    assert result["accepted"]
    assert result["dry_run"]
    pos_id = result["position_id"]

    feed.set_price("BTCUSDT", 99000)
    close = await eng.close_position(pos_id, reason="take_profit")
    assert close["closed"]
    assert close["pnl"] > 0
    await eng.stop()


@pytest.mark.asyncio
async def test_kill_switch():
    eng = get_live_engine()
    get_market_feed().set_price("BTCUSDT", 50000)
    await eng.start()
    await eng.process_signal(
        LiveSignal(symbol="BTCUSDT", direction="SHORT", entry=50000, strategy_name="manual", manual_override=True)
    )
    result = await eng.kill_switch()
    assert result["kill_switch"]
    assert eng.store.circuit.kill_switch
    await eng.stop()


@pytest.mark.asyncio
async def test_live_api():
    from httpx import ASGITransport, AsyncClient
    from app.main import create_app

    app = create_app()
    get_market_feed().set_price("BTCUSDT", 50000)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        start = await ac.post("/live/start")
        assert start.status_code == 200

        r = await ac.post(
            "/live/order",
            json={
                "symbol": "BTCUSDT",
                "direction": "SHORT",
                "confidence": 85,
                "entry": 50000,
                "sl": 51000,
                "tp1": 49000,
                "strategy_name": "manual",
                "manual_override": True,
            },
        )
        assert r.status_code == 200
        assert r.json()["accepted"]

        dash = await ac.get("/live/dashboard")
        assert dash.status_code == 200
        assert "health" in dash.json()

        risk = await ac.get("/live/risk")
        assert risk.status_code == 200

        await ac.post("/live/stop")
