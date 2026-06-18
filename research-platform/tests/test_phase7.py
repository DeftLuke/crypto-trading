"""Phase 7 paper trading tests."""

import pytest

from app.core.config import get_settings
from app.memory.embeddings.service import get_embedding_service
from app.memory.qdrant.client import get_qdrant_store
from app.memory.service import get_memory_service
from app.paper_trading.engine import get_paper_engine
from app.paper_trading.execution.simulator import ExecutionSimulator
from app.paper_trading.market_data.feed import get_market_feed
from app.paper_trading.portfolio.sizing import PositionSizer
from app.paper_trading.risk.engine import RiskEngine
from app.paper_trading.store import PaperStore
from app.paper_trading.types import PaperAccount, PaperOrder, OrderType, PaperPosition, PositionStatus, PaperTrade, SignalIntake
from app.paper_trading.validation.engine import ValidationEngine


@pytest.fixture(autouse=True)
def paper_env(monkeypatch):
    monkeypatch.setenv("QDRANT_URL", ":memory:")
    monkeypatch.setenv("MEMORY_EMBEDDING_PROVIDER", "hash")
    monkeypatch.setenv("PAPER_LATENCY_MS", "0")
    monkeypatch.setenv("PAPER_VALIDATION_MIN_TRADES", "5")
    get_settings.cache_clear()
    get_paper_engine.cache_clear()
    get_qdrant_store.cache_clear()
    get_embedding_service.cache_clear()
    get_memory_service.cache_clear()
    yield
    get_paper_engine.cache_clear()
    get_settings.cache_clear()


class TestPositionSizer:
    def test_margin_sizing(self):
        qty, lev, margin = PositionSizer().compute(1000, 100000, mode="margin_pct", margin_pct=0.5, leverage=50)
        assert lev == 50
        assert margin == 500
        assert qty > 0


class TestRiskEngine:
    def test_blocks_max_positions(self, monkeypatch):
        monkeypatch.setenv("PAPER_MAX_POSITIONS", "1")
        get_settings.cache_clear()
        store = PaperStore()
        acc = PaperAccount(balance=1000, equity=1000)
        store.accounts[acc.account_id] = acc
        store.positions["p1"] = PaperPosition(
            account_id=acc.account_id, symbol="BTCUSDT", direction="SHORT",
            entry_price=100, quantity=1, notional=100, leverage=10, margin=10, status=PositionStatus.OPEN,
        )
        risk = RiskEngine(store)
        ok, _ = risk.validate_signal(acc.account_id, SignalIntake(symbol="ETHUSDT", direction="SHORT"))
        assert not ok


class TestExecutionSimulator:
    def test_market_fill(self):
        order = PaperOrder(account_id="a", symbol="BTCUSDT", direction="SHORT", order_type=OrderType.MARKET, quantity=0.1)
        filled = ExecutionSimulator().simulate_fill(order, 100000, "SHORT")
        assert filled.status.value in ("filled", "partial")
        assert filled.filled_price


class TestValidationEngine:
    def test_evaluate(self):
        trades = [
            PaperTrade(
                account_id="a", position_id="p", strategy_name="test_strat",
                symbol="BTCUSDT", direction="SHORT", entry_price=100, exit_price=99,
                quantity=1, leverage=10, margin=10, pnl_usd=10 if i < 7 else -5,
                pnl_pct=1, result="WIN" if i < 7 else "LOSS",
            )
            for i in range(10)
        ]
        val = ValidationEngine().evaluate("test_strat", trades)
        assert val.verdict in ("pass", "warning", "reject")


@pytest.mark.asyncio
async def test_paper_open_and_close():
    eng = get_paper_engine()
    feed = get_market_feed()
    feed.set_price("BTCUSDT", 100000)

    signal = SignalIntake(
        symbol="BTCUSDT", direction="SHORT", confidence=91, entry=100000,
        sl=101000, tp1=99000, strategy_name="test_paper",
    )
    result = await eng.process_signal(signal)
    assert result["accepted"]
    pos_id = result["position_id"]

    feed.set_price("BTCUSDT", 99000)
    close = await eng.close_position(pos_id, reason="take_profit")
    assert close["closed"]
    assert close["pnl"] > 0


@pytest.mark.asyncio
async def test_paper_api():
    from httpx import ASGITransport, AsyncClient
    from app.main import create_app

    app = create_app()
    get_market_feed().set_price("BTCUSDT", 50000)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/paper/order", json={
            "symbol": "BTCUSDT", "direction": "SHORT", "confidence": 85,
            "entry": 50000, "sl": 51000, "tp1": 49000, "strategy_name": "api_test",
        })
        assert r.status_code == 200

        dash = await ac.get("/paper/dashboard")
        assert dash.status_code == 200
        assert "health" in dash.json()
