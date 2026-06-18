"""Background job scheduler."""

from apscheduler.schedulers.background import BackgroundScheduler

from app.core.config import get_settings
from app.core.logging import get_logger
from app.tasks.jobs import (
    job_build_feature_dataset,
    job_calculate_indicators,
    job_record_health,
    job_sync_latest_data,
    job_validate_data,
)
from app.tasks.memory_jobs import job_memory_learning_cycle
from app.tasks.agent_jobs import job_agent_research_cycle

logger = get_logger("workers.scheduler")
_scheduler: BackgroundScheduler | None = None


def start_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        return
    settings = get_settings()
    _scheduler = BackgroundScheduler()
    _scheduler.add_job(
        job_sync_latest_data,
        "interval",
        minutes=settings.sync_interval_minutes,
        id="sync_latest_data",
        replace_existing=True,
    )
    _scheduler.add_job(
        job_validate_data,
        "cron",
        hour=2,
        minute=0,
        id="validate_data",
        replace_existing=True,
    )
    _scheduler.add_job(
        job_calculate_indicators,
        "cron",
        hour=3,
        minute=0,
        id="calculate_indicators",
        replace_existing=True,
    )
    _scheduler.add_job(
        job_build_feature_dataset,
        "cron",
        hour=4,
        minute=0,
        id="build_feature_dataset",
        replace_existing=True,
    )
    _scheduler.add_job(
        job_record_health,
        "interval",
        minutes=30,
        id="record_health",
        replace_existing=True,
    )
    if settings.memory_enabled:
        _scheduler.add_job(
            job_memory_learning_cycle,
            "interval",
            minutes=settings.memory_worker_interval_minutes,
            id="memory_learning_cycle",
            replace_existing=True,
        )
    if settings.agent_enabled:
        _scheduler.add_job(
            job_agent_research_cycle,
            "interval",
            minutes=settings.agent_cycle_interval_minutes,
            id="agent_research_cycle",
            replace_existing=True,
        )
    _scheduler.start()
    logger.info("Scheduler started")


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        logger.info("Scheduler stopped")
