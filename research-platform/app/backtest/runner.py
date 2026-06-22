"""Async job runner for backtests."""

import asyncio
from typing import Any
from uuid import uuid4

from app.backtest.config import BacktestConfig, BacktestMode
from app.backtest.engine import BacktestEngine
from app.backtest.export import ExportEngine
from app.backtest.types import BacktestResult
from app.core.logging import get_logger
from app.signals.rules_engine import StrategyRule, StrategyRulesEngine
from app.strategies.registry import is_e5_strategy
from app.strategies.e5_institutional.engine import E5InstitutionalEngine
from app.strategies.e5_institutional.reports import export_e5_reports

logger = get_logger("backtest.runner")

_active_jobs: dict[str, asyncio.Task] = {}
_job_status: dict[str, dict[str, Any]] = {}
_stop_flags: set[str] = set()


class BacktestRunner:
    def __init__(self) -> None:
        self.export = ExportEngine()

    async def start(
        self,
        config: BacktestConfig,
        rules: list[StrategyRule] | None = None,
        backtest_id: str | None = None,
        persist_fn=None,
    ) -> str:
        bid = backtest_id or str(uuid4())
        _job_status[bid] = {"status": "pending", "progress_pct": 0, "backtest_id": bid}
        task = asyncio.create_task(self._execute(bid, config, rules, persist_fn))
        _active_jobs[bid] = task
        return bid

    def stop(self, backtest_id: str) -> bool:
        _stop_flags.add(backtest_id)
        task = _active_jobs.get(backtest_id)
        if task and not task.done():
            task.cancel()
            return True
        return backtest_id in _stop_flags

    def status(self, backtest_id: str) -> dict[str, Any]:
        return _job_status.get(backtest_id, {"status": "unknown", "backtest_id": backtest_id})

    async def _execute(
        self,
        backtest_id: str,
        config: BacktestConfig,
        rules: list[StrategyRule] | None,
        persist_fn,
    ) -> BacktestResult | None:
        _job_status[backtest_id] = {"status": "running", "progress_pct": 5, "backtest_id": backtest_id}
        try:
            use_e5 = is_e5_strategy(config.strategy_name) or config.mode == BacktestMode.E5
            loop = asyncio.get_event_loop()
            if use_e5:
                if config.min_confidence <= 1:
                    config.min_confidence = 85.0
                engine = E5InstitutionalEngine(config)
                result: BacktestResult = await loop.run_in_executor(None, lambda: engine.run(backtest_id))
            else:
                engine = BacktestEngine(config, rules or StrategyRulesEngine.default_short_rules())
                result = await loop.run_in_executor(None, lambda: engine.run(backtest_id))

            if backtest_id in _stop_flags:
                _job_status[backtest_id] = {"status": "stopped", "progress_pct": 100, "backtest_id": backtest_id}
                return result

            run_id = str(uuid4())
            if use_e5:
                export_paths = export_e5_reports(result, run_id)
            else:
                export_paths = self.export.export_all(result, run_id)

            if persist_fn:
                await persist_fn(result, run_id, export_paths)

            _job_status[backtest_id] = {
                "status": "completed",
                "progress_pct": 100,
                "backtest_id": backtest_id,
                "run_id": run_id,
                "metrics": result.metrics,
                "export_paths": export_paths,
            }
            return result
        except asyncio.CancelledError:
            _job_status[backtest_id] = {"status": "stopped", "progress_pct": 0, "backtest_id": backtest_id}
            return None
        except Exception as exc:
            logger.exception("Backtest failed", extra={"backtest_id": backtest_id})
            _job_status[backtest_id] = {
                "status": "failed",
                "progress_pct": 0,
                "backtest_id": backtest_id,
                "error": str(exc),
            }
            return None
        finally:
            _active_jobs.pop(backtest_id, None)
            _stop_flags.discard(backtest_id)


runner = BacktestRunner()
