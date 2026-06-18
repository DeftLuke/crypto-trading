"""Phase 7 — Paper Trading API."""

import asyncio
import json

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from app.core.logging import get_logger
from app.paper_trading.engine import get_paper_engine
from app.paper_trading.types import SignalIntake
from app.schemas.paper import PaperCloseRequest, PaperMoveSlRequest, PaperMoveTpRequest, PaperSignalRequest

logger = get_logger("api.phase7")
router = APIRouter(tags=["paper"])

_ws_clients: list[WebSocket] = []


def _engine():
    return get_paper_engine()


@router.post("/paper/start")
async def paper_start():
    try:
        return await _engine().start()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/paper/stop")
async def paper_stop():
    try:
        return await _engine().stop()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/paper/order")
async def paper_order(body: PaperSignalRequest):
    """Accept signal and simulate paper entry."""
    try:
        signal = SignalIntake(**body.model_dump())
        return await _engine().process_signal(signal, body.account_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/paper/close")
async def paper_close(body: PaperCloseRequest):
    try:
        return await _engine().close_position(body.position_id, body.partial_pct, body.reason)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/paper/move-sl")
async def paper_move_sl(body: PaperMoveSlRequest):
    return _engine().move_sl(body.position_id, body.stop_loss)


@router.post("/paper/move-tp")
async def paper_move_tp(body: PaperMoveTpRequest):
    return _engine().move_tp(body.position_id, body.take_profit)


@router.get("/paper/accounts")
async def paper_accounts():
    eng = _engine()
    return {"accounts": [a.model_dump(mode="json") for a in eng.store.accounts.values()]}


@router.get("/paper/positions")
async def paper_positions(account_id: str | None = None):
    eng = _engine()
    positions = eng.store.get_open_positions(account_id)
    return {"count": len(positions), "positions": [p.model_dump(mode="json") for p in positions]}


@router.get("/paper/trades")
async def paper_trades(limit: int = 100, strategy: str | None = None):
    eng = _engine()
    trades = eng.store.get_trades(limit, strategy)
    return {"count": len(trades), "trades": [t.model_dump(mode="json") for t in trades]}


@router.get("/paper/performance")
async def paper_performance(strategy: str | None = None):
    eng = _engine()
    trades = eng.store.get_trades(5000, strategy)
    metrics = eng.analytics.compute(trades)
    return {
        "overall": metrics,
        "by_session": eng.analytics.by_session(trades),
        "by_symbol": eng.analytics.by_symbol(trades),
        "by_strategy": eng.analytics.by_strategy(trades),
    }


@router.get("/paper/strategies")
async def paper_strategies():
    eng = _engine()
    return {"strategies": eng.store.strategy_metrics}


@router.get("/paper/approvals")
async def paper_approvals():
    eng = _engine()
    return {
        "validations": {k: v.model_dump(mode="json") for k, v in eng.store.validations.items()},
        "approvals": eng.store.approvals,
    }


@router.get("/paper/risk")
async def paper_risk(account_id: str | None = None):
    eng = _engine()
    aid = account_id or eng.default_account_id
    return eng.risk.status(aid)


@router.get("/paper/portfolio")
async def paper_portfolio():
    eng = _engine()
    return {
        "accounts": [a.model_dump(mode="json") for a in eng.store.accounts.values()],
        "health": eng.health(),
    }


@router.get("/paper/dashboard")
async def paper_dashboard():
    """Phase 4 dashboard bundle."""
    eng = _engine()
    trades = eng.store.get_trades(500)
    return {
        "health": eng.health(),
        "accounts": [a.model_dump(mode="json") for a in eng.store.accounts.values()],
        "positions": [p.model_dump(mode="json") for p in eng.store.get_open_positions()],
        "recent_trades": [t.model_dump(mode="json") for t in trades[:10]],
        "performance": eng.analytics.compute(trades),
        "approvals": eng.store.approvals,
        "approval_queue": [
            v.model_dump(mode="json") for v in eng.store.validations.values() if v.verdict != "pass"
        ],
        "risk": eng.risk.status(eng.default_account_id),
    }


@router.websocket("/paper/ws")
async def paper_ws(websocket: WebSocket):
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
