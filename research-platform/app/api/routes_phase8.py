"""Phase 8 — Live Trading API."""

import asyncio
import json

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from app.core.logging import get_logger
from app.live_trading.engine import get_live_engine
from app.live_trading.types import LiveSignal
from app.schemas.live import (
    LiveCloseRequest,
    LiveDisableStrategyRequest,
    LiveMoveSlRequest,
    LiveMoveTpRequest,
    LiveSignalRequest,
)

logger = get_logger("api.phase8")
router = APIRouter(tags=["live"])

_ws_clients: list[WebSocket] = []


def _engine():
    return get_live_engine()


@router.post("/live/start")
async def live_start():
    try:
        return await _engine().start()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/live/stop")
async def live_stop():
    try:
        return await _engine().stop()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/live/order")
async def live_order(body: LiveSignalRequest):
    try:
        signal = LiveSignal(**body.model_dump())
        return await _engine().process_signal(signal, body.account_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/live/close")
async def live_close(body: LiveCloseRequest):
    try:
        return await _engine().close_position(body.position_id, body.partial_pct, body.reason)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/live/kill-switch")
async def live_kill_switch():
    try:
        return await _engine().kill_switch()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/live/close-all")
async def live_close_all():
    try:
        return await _engine().close_all(reason="close_all")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/live/pause")
async def live_pause():
    return _engine().pause()


@router.post("/live/resume")
async def live_resume():
    return _engine().resume()


@router.post("/live/reset-circuit")
async def live_reset_circuit():
    return _engine().reset_circuit()


@router.post("/live/disable-strategy")
async def live_disable_strategy(body: LiveDisableStrategyRequest):
    return _engine().disable_strategy(body.strategy_name)


@router.post("/live/move-sl")
async def live_move_sl(body: LiveMoveSlRequest):
    return await _engine().move_sl(body.position_id, body.stop_loss)


@router.post("/live/move-tp")
async def live_move_tp(body: LiveMoveTpRequest):
    return await _engine().move_tp(body.position_id, body.take_profit)


@router.get("/live/accounts")
async def live_accounts():
    eng = _engine()
    return {"accounts": [a.model_dump(mode="json") for a in eng.store.accounts.values()]}


@router.get("/live/positions")
async def live_positions(account_id: str | None = None):
    eng = _engine()
    positions = eng.store.open_positions(account_id)
    return {"count": len(positions), "positions": [p.model_dump(mode="json") for p in positions]}


@router.get("/live/orders")
async def live_orders(limit: int = 100):
    eng = _engine()
    orders = sorted(eng.store.orders.values(), key=lambda o: o.created_at, reverse=True)[:limit]
    return {"count": len(orders), "orders": [o.model_dump(mode="json") for o in orders]}


@router.get("/live/trades")
async def live_trades(limit: int = 100, strategy: str | None = None):
    eng = _engine()
    trades = eng.store.get_trades(limit, strategy)
    return {"count": len(trades), "trades": [t.model_dump(mode="json") for t in trades]}


@router.get("/live/performance")
async def live_performance(strategy: str | None = None):
    eng = _engine()
    trades = eng.store.get_trades(5000, strategy)
    return {
        "overall": eng.analytics.compute(trades),
        "by_strategy": eng.analytics.by_strategy(trades),
        "by_symbol": eng.analytics.by_symbol(trades),
        "execution": eng.execution_stats(),
    }


@router.get("/live/risk")
async def live_risk(account_id: str | None = None):
    eng = _engine()
    aid = account_id or eng.default_account_id
    return eng.risk.status(aid)


@router.get("/live/portfolio")
async def live_portfolio():
    eng = _engine()
    return {
        "snapshot": eng.portfolio_snapshot(),
        "health": eng.health(),
    }


@router.get("/live/exchange-status")
async def live_exchange_status():
    eng = _engine()
    return {"exchanges": eng.store.exchange_status, "execution": eng.execution_stats()}


@router.get("/live/deployments/{strategy_name}")
async def live_deployment_check(strategy_name: str):
    return _engine().gate.deployment_checklist(strategy_name)


@router.get("/live/dashboard")
async def live_dashboard():
    eng = _engine()
    trades = eng.store.get_trades(500)
    aid = eng.default_account_id
    return {
        "health": eng.health(),
        "accounts": [a.model_dump(mode="json") for a in eng.store.accounts.values()],
        "positions": [p.model_dump(mode="json") for p in eng.store.open_positions()],
        "recent_trades": [t.model_dump(mode="json") for t in trades[:10]],
        "performance": eng.analytics.compute(trades),
        "risk": eng.risk.status(aid),
        "portfolio": eng.portfolio_snapshot(aid),
        "exchange": eng.store.exchange_status,
        "execution": eng.execution_stats(),
        "circuit_breaker": eng.store.circuit.model_dump(mode="json"),
    }


@router.websocket("/live/ws")
async def live_ws(websocket: WebSocket):
    await websocket.accept()
    _ws_clients.append(websocket)
    eng = _engine()

    def broadcast(msg: dict):
        asyncio.create_task(_send_all(msg))

    eng.subscribe_ws(broadcast)

    try:
        await websocket.send_json({"type": "connected", "health": eng.health()})
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if msg.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        pass
    finally:
        if websocket in _ws_clients:
            _ws_clients.remove(websocket)


async def _send_all(msg: dict):
    dead = []
    for ws in _ws_clients:
        try:
            await ws.send_json(msg)
        except Exception:
            dead.append(ws)
    for ws in dead:
        if ws in _ws_clients:
            _ws_clients.remove(ws)
