"""Phase 9 — Operations & n8n AI Agent API."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.core.logging import get_logger
from app.operations.engine import get_operations_engine
from app.operations.types import ChatRequest
from app.schemas.operations import (
    ChatRequestBody,
    EventEmitRequest,
    TaskRequestBody,
    TelegramWebhookBody,
    WorkflowRunRequest,
)

logger = get_logger("api.phase9")
router = APIRouter(tags=["operations"])


def _engine():
    return get_operations_engine()


@router.post("/agent/chat")
async def agent_chat(body: ChatRequestBody):
    try:
        req = ChatRequest(**body.model_dump())
        resp = await _engine().chat(req)
        return resp.model_dump(mode="json")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/agent/task")
async def agent_task(body: TaskRequestBody):
    try:
        task = await _engine().run_task(body.task_type, body.params)
        return task.model_dump(mode="json")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/agent/report")
async def agent_report(body: TaskRequestBody):
    try:
        task = await _engine().run_task("report", {"report_type": body.task_type, **body.params})
        return task.model_dump(mode="json")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/agent/workflow/run")
async def agent_workflow_run(body: WorkflowRunRequest):
    try:
        run = await _engine().workflows.run_workflow(body.workflow_name, body.payload)
        return run.model_dump(mode="json")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/operations/event")
async def operations_event(body: EventEmitRequest):
    try:
        run = await _engine().workflows.emit(body.event_type, body.payload)
        return run.model_dump(mode="json")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/operations/telegram")
async def operations_telegram(body: TelegramWebhookBody):
    try:
        answer = await _engine().handle_telegram_command(body.text, body.chat_id)
        return {"answer": answer}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/agent/history")
async def agent_history(user_id: str | None = None, limit: int = 20):
    eng = _engine()
    convs = eng.store.recent_conversations(user_id, limit)
    return {
        "conversations": [
            {
                "conversation_id": c.conversation_id,
                "channel": c.channel,
                "messages": [m.model_dump(mode="json") for m in c.messages[-4:]],
                "updated_at": c.updated_at.isoformat(),
            }
            for c in convs
        ]
    }


@router.get("/agent/tasks")
async def agent_tasks():
    eng = _engine()
    return {
        "active": [t.model_dump(mode="json") for t in eng.store.active_tasks()],
        "recent": [t.model_dump(mode="json") for t in sorted(eng.store.tasks.values(), key=lambda x: x.created_at, reverse=True)[:20]],
    }


@router.get("/agent/reports")
async def agent_reports(limit: int = 20):
    eng = _engine()
    return {"reports": [r.model_dump(mode="json") for r in eng.store.get_reports(limit)]}


@router.get("/operations/status")
async def operations_status():
    return _engine().status()


@router.get("/agent/workflows")
async def agent_workflows(limit: int = 20):
    eng = _engine()
    runs = eng.store.workflows[-limit:]
    return {"workflows": [w.model_dump(mode="json") for w in runs]}


@router.get("/operations/dashboard")
async def operations_dashboard():
    return _engine().dashboard_payload()


@router.get("/operations/reports/{report_id}/download")
async def download_report(report_id: str):
    eng = _engine()
    report = eng.store.reports.get(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    data = eng.reports.read_report_file(report_id)
    if not data:
        raise HTTPException(status_code=404, detail="Report file not found")
    mime, content = data
    return Response(content=content, media_type=mime, headers={"Content-Disposition": f'attachment; filename="{report_id}"'})
