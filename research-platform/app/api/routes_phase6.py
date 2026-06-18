"""Phase 6 — AI Research Agent API."""

from fastapi import APIRouter, HTTPException

from app.agents.orchestrator import get_orchestrator
from app.core.logging import get_logger

logger = get_logger("api.phase6")
router = APIRouter(tags=["agent"])


@router.post("/agent/research/start")
async def start_research():
    try:
        orch = get_orchestrator()
        return await orch.start()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/agent/research/stop")
async def stop_research():
    try:
        orch = get_orchestrator()
        return await orch.stop()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/agent/research/cycle")
async def run_single_cycle():
    """Run one research cycle manually."""
    try:
        orch = get_orchestrator()
        return await orch.run_once()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/agent/status")
async def agent_status():
    return get_orchestrator().status()


@router.get("/agent/insights")
async def agent_insights():
    orch = get_orchestrator()
    return {
        "count": len(orch.coordinator.insights),
        "insights": [i.model_dump(mode="json") for i in orch.coordinator.insights],
    }


@router.get("/agent/hypotheses")
async def agent_hypotheses():
    orch = get_orchestrator()
    return {
        "count": len(orch.coordinator.hypotheses),
        "hypotheses": [h.model_dump(mode="json") for h in orch.coordinator.hypotheses],
    }


@router.get("/agent/reflections")
async def agent_reflections():
    orch = get_orchestrator()
    return {"count": len(orch.coordinator.reflections), "reflections": orch.coordinator.reflections}


@router.get("/agent/patterns")
async def agent_patterns():
    patterns = get_orchestrator().coordinator.memory.top_patterns(20)
    return {"count": len(patterns), "patterns": patterns}


@router.get("/agent/recommendations")
async def agent_recommendations():
    orch = get_orchestrator()
    return {
        "count": len(orch.coordinator.recommendations),
        "recommendations": [r.model_dump(mode="json") for r in orch.coordinator.recommendations],
    }


@router.get("/agent/rankings")
async def agent_rankings():
    orch = get_orchestrator()
    return {"count": len(orch.coordinator.rankings), "rankings": orch.coordinator.rankings}


@router.get("/agent/plans")
async def agent_plans():
    orch = get_orchestrator()
    return {
        "count": len(orch.coordinator.plans),
        "plans": [p.model_dump(mode="json") for p in orch.coordinator.plans],
    }


@router.get("/agent/learning")
async def agent_learning():
    orch = get_orchestrator()
    snap = orch.coordinator.learning_snapshot
    return snap.model_dump(mode="json") if snap else {}


@router.get("/agent/dashboard")
async def agent_dashboard():
    """Phase 4 dashboard bundle."""
    try:
        return get_orchestrator().dashboard_payload()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
