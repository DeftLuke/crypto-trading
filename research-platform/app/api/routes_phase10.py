"""Phase 10 — Enterprise Control Center API."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.control_center.engine import get_control_center
from app.core.logging import get_logger
from app.schemas.control_center import (
    ApprovalActionRequest,
    EmergencyActionRequest,
    ServiceActionRequest,
    SettingsUpdateRequest,
    SignalExecuteRequest,
)

logger = get_logger("api.phase10")
router = APIRouter(tags=["control"])


def _cc():
    return get_control_center()


@router.get("/control/dashboard")
async def control_dashboard():
    return await _cc().dashboard()


@router.get("/control/services")
async def control_services():
    services = await _cc().services.refresh()
    return {"services": [s.model_dump(mode="json") for s in services]}


@router.post("/control/services/{service_id}/start")
async def service_start(service_id: str, body: ServiceActionRequest | None = None):
    try:
        actor = body.actor if body else "admin"
        _cc().audit.log("system", f"start_{service_id}", actor=actor)
        return await _cc().services.start(service_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/control/services/{service_id}/stop")
async def service_stop(service_id: str, body: ServiceActionRequest | None = None):
    try:
        actor = body.actor if body else "admin"
        _cc().audit.log("system", f"stop_{service_id}", actor=actor)
        return await _cc().services.stop(service_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/control/services/{service_id}/restart")
async def service_restart(service_id: str, body: ServiceActionRequest | None = None):
    try:
        return await _cc().services.restart(service_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/control/exchanges")
async def control_exchanges():
    exchanges = await _cc().exchanges.all_status()
    return {"supported": _cc().exchanges.list_supported(), "exchanges": [e.model_dump(mode="json") for e in exchanges]}


@router.post("/control/exchanges/{exchange_id}/connect")
async def exchange_connect(exchange_id: str):
    try:
        conn = await _cc().exchanges.connect(exchange_id)
        _cc().audit.log("system", "exchange_connect", detail={"exchange": exchange_id})
        return conn.model_dump(mode="json")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/control/exchanges/{exchange_id}/disconnect")
async def exchange_disconnect(exchange_id: str):
    return await _cc().exchanges.disconnect(exchange_id)


@router.post("/control/exchanges/{exchange_id}/sync")
async def exchange_sync(exchange_id: str):
    conn = await _cc().exchanges.sync(exchange_id)
    return conn.model_dump(mode="json")


@router.post("/control/exchanges/{exchange_id}/test")
async def exchange_test(exchange_id: str):
    return await _cc().exchanges.test(exchange_id)


@router.get("/control/settings")
async def control_settings():
    return _cc().store.settings.model_dump(mode="json")


@router.post("/control/settings")
async def control_settings_update(body: SettingsUpdateRequest):
    if body.mode == "live" and body.confirm_live is not True:
        raise HTTPException(status_code=400, detail="Switching to live mode requires confirm_live=true")
    return _cc().update_settings(body.model_dump(exclude={"confirm_live"}, exclude_none=True), body.actor).model_dump(mode="json")


@router.post("/control/signal")
async def control_signal(body: SignalExecuteRequest):
    """Unified signal intake — replaces legacy n8n → /api/execute."""
    try:
        return await _cc().pipeline.process_signal(body.model_dump(exclude_none=True), source=body.source)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/control/approve")
async def control_approve(body: ApprovalActionRequest):
    try:
        return await _cc().pipeline.approve_and_execute(body.approval_id, body.passcode, body.actor)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/control/reject")
async def control_reject(body: ApprovalActionRequest):
    return await _cc().pipeline.reject_approval(body.approval_id, body.actor)


@router.get("/control/approvals")
async def control_approvals():
    return {"pending": [a.model_dump(mode="json") for a in _cc().store.pending_approvals()]}


@router.get("/control/journal")
async def control_journal(limit: int = 100):
    _cc().journal.sync_from_engines()
    entries = _cc().store.get_journal(limit)
    return {"count": len(entries), "entries": [e.model_dump(mode="json") for e in entries]}


@router.get("/control/audit")
async def control_audit(limit: int = 200, category: str | None = None):
    logs = _cc().store.audit_logs(limit, category)
    return {"count": len(logs), "logs": [l.model_dump(mode="json") for l in logs]}


@router.get("/control/notifications")
async def control_notifications(limit: int = 50):
    notes = _cc().store.notifications[-limit:]
    return {"count": len(notes), "notifications": [n.model_dump(mode="json") for n in notes]}


@router.post("/control/emergency/{action}")
async def control_emergency(action: str, body: EmergencyActionRequest | None = None):
    actor = body.actor if body else "admin"
    cc = _cc()
    actions = {
        "stop-auto-trading": cc.emergency.stop_auto_trading,
        "close-all": cc.emergency.close_all_positions,
        "kill-switch": cc.emergency.kill_switch,
        "pause-research": cc.emergency.pause_research,
        "pause-ai": cc.emergency.pause_ai_agent,
        "disable-strategies": cc.emergency.disable_strategies,
    }
    if action == "disable-exchange":
        if not body or not body.exchange_id:
            raise HTTPException(status_code=400, detail="exchange_id required")
        return await cc.emergency.disable_exchange(body.exchange_id, actor)
    fn = actions.get(action)
    if not fn:
        raise HTTPException(status_code=404, detail=f"Unknown action: {action}")
    return await fn(actor)
