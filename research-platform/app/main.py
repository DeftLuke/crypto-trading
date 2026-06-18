from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.api.routes_phase2 import router as phase2_router
from app.api.routes_phase3 import router as phase3_router
from app.api.routes_phase5 import router as phase5_router
from app.api.routes_phase6 import router as phase6_router
from app.api.routes_phase7 import router as phase7_router
from app.api.routes_phase8 import router as phase8_router
from app.api.routes_phase9 import router as phase9_router
from app.api.routes_phase10 import router as phase10_router
from app.core.config import get_settings
from app.core.logging import setup_logging
from app.workers.scheduler import start_scheduler, stop_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    settings = get_settings()
    if settings.scheduler_enabled:
        start_scheduler()
    if settings.paper_enabled and settings.paper_auto_start:
        from app.paper_trading.engine import get_paper_engine
        await get_paper_engine().start()
    if settings.live_enabled and settings.live_auto_start:
        from app.live_trading.engine import get_live_engine
        await get_live_engine().start()
    yield
    if settings.paper_enabled:
        from app.paper_trading.engine import get_paper_engine
        eng = get_paper_engine()
        if eng._running:
            await eng.stop()
    if settings.live_enabled:
        from app.live_trading.engine import get_live_engine
        live = get_live_engine()
        if live._running:
            await live.stop()
    stop_scheduler()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Research Platform",
        description="Phase 10 — Enterprise Control Center & Production Layer",
        version="0.10.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)
    app.include_router(router, prefix="/api/v1")
    app.include_router(phase2_router)
    app.include_router(phase2_router, prefix="/api/v1")
    app.include_router(phase3_router)
    app.include_router(phase3_router, prefix="/api/v1")
    app.include_router(phase5_router)
    app.include_router(phase5_router, prefix="/api/v1")
    app.include_router(phase6_router)
    app.include_router(phase6_router, prefix="/api/v1")
    app.include_router(phase7_router)
    app.include_router(phase7_router, prefix="/api/v1")
    app.include_router(phase8_router)
    app.include_router(phase8_router, prefix="/api/v1")
    app.include_router(phase9_router)
    app.include_router(phase9_router, prefix="/api/v1")
    app.include_router(phase10_router)
    app.include_router(phase10_router, prefix="/api/v1")
    return app


app = create_app()
