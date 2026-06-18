"""Phase 5 — Qdrant memory layer API."""

from fastapi import APIRouter, HTTPException

from app.core.logging import get_logger
from app.memory.service import get_memory_service
from app.schemas.memory import (
    BacktestMemoryRequest,
    DashboardMemoryResponse,
    MemoryStatsResponse,
    MemoryStoreResponse,
    PatternMemoryRequest,
    RecallRequest,
    ReflectionMemoryRequest,
    SearchRequest,
    SignalMemoryRequest,
    StrategyMemoryRequest,
    TradeMemoryRequest,
)

logger = get_logger("api.phase5")
router = APIRouter(tags=["memory"])


def _store_response(result: dict) -> MemoryStoreResponse:
    return MemoryStoreResponse(
        memory_id=result["memory_id"],
        collection=result.get("collection", ""),
        memory_rank=result.get("memory_rank", 0.0),
        point_id=result.get("point_id"),
    )


@router.post("/memory/trade", response_model=MemoryStoreResponse)
async def store_trade(body: TradeMemoryRequest):
    try:
        svc = get_memory_service()
        result = svc.store_trade(body.model_dump())
        return _store_response(result)
    except Exception as e:
        logger.exception("store_trade failed")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/memory/signal", response_model=MemoryStoreResponse)
async def store_signal(body: SignalMemoryRequest):
    try:
        result = get_memory_service().store_signal(body.model_dump())
        return _store_response(result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/memory/backtest", response_model=MemoryStoreResponse)
async def store_backtest(body: BacktestMemoryRequest):
    try:
        result = get_memory_service().store_backtest(body.model_dump())
        return _store_response(result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/memory/reflection", response_model=MemoryStoreResponse)
async def store_reflection(body: ReflectionMemoryRequest):
    try:
        result = get_memory_service().store_reflection(body.model_dump())
        return _store_response(result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/memory/pattern", response_model=MemoryStoreResponse)
async def store_pattern(body: PatternMemoryRequest):
    try:
        result = get_memory_service().store_pattern(body.model_dump())
        return _store_response(result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/memory/strategy", response_model=MemoryStoreResponse)
async def store_strategy(body: StrategyMemoryRequest):
    try:
        result = get_memory_service().store_strategy(body.model_dump())
        return _store_response(result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/memory/recall")
async def memory_recall(body: RecallRequest):
    try:
        setup = body.model_dump(exclude={"limit"})
        setup["limit"] = body.limit
        return get_memory_service().recall(setup)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/memory/search")
async def memory_search(body: SearchRequest):
    try:
        results = get_memory_service().search(
            body.query,
            body.collection,
            body.mode,
            body.limit,
            body.filters or None,
        )
        return {"count": len(results), "results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/memory/stats", response_model=MemoryStatsResponse)
async def memory_stats():
    try:
        return MemoryStatsResponse(**get_memory_service().stats())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/memory/collections")
async def memory_collections():
    try:
        stats = get_memory_service().stats()
        return {"collections": stats["collections"], "embedding_model": stats["embedding_model"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/memory/top-patterns")
async def top_patterns(limit: int = 10):
    try:
        return {"count": limit, "patterns": get_memory_service().top_patterns(limit)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/memory/reflections")
async def list_reflections(limit: int = 20):
    try:
        items = get_memory_service().list_reflections(limit)
        return {"count": len(items), "reflections": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/memory/agent-state")
async def agent_state():
    try:
        return get_memory_service().get_agent_state()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/memory/dashboard", response_model=DashboardMemoryResponse)
async def memory_dashboard():
    """Phase 4 dashboard integration — patterns, reflections, learning progress."""
    try:
        svc = get_memory_service()
        stats = svc.stats()
        patterns = svc.top_patterns(5)
        reflections = svc.list_reflections(5)
        state = svc.get_agent_state()
        trades_count = stats["collections"].get("trade_memories", 0)
        return DashboardMemoryResponse(
            top_patterns=patterns,
            top_reflections=reflections,
            agent_state=state,
            stats=MemoryStatsResponse(**stats),
            learning_progress={
                "total_memories": stats["total_memories"],
                "trades_indexed": trades_count,
                "patterns_stored": stats["collections"].get("pattern_memories", 0),
                "reflections_stored": stats["collections"].get("reflection_memories", 0),
            },
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/memory/learning-cycle")
async def trigger_learning_cycle():
    """Manual trigger for continuous learning worker."""
    try:
        return get_memory_service().run_learning_cycle()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
