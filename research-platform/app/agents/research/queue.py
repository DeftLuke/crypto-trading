"""Research task queue — in-memory with optional Redis persistence."""

from __future__ import annotations

import heapq
import json
from typing import Any

from app.agents.types import ResearchTask, TaskStatus, TaskType, utc_now
from app.core.logging import get_logger

logger = get_logger("agents.research.queue")

REDIS_QUEUE_KEY = "agent:research:queue"


class ResearchQueue:
    def __init__(self) -> None:
        self._heap: list[tuple[float, str, ResearchTask]] = []
        self._tasks: dict[str, ResearchTask] = {}

    def enqueue(self, task: ResearchTask) -> ResearchTask:
        task.status = TaskStatus.PENDING
        self._tasks[task.task_id] = task
        heapq.heappush(self._heap, (-task.priority, task.task_id, task))
        return task

    def dequeue(self) -> ResearchTask | None:
        while self._heap:
            _, tid, task = heapq.heappop(self._heap)
            if tid in self._tasks and self._tasks[tid].status == TaskStatus.PENDING:
                task.status = TaskStatus.RUNNING
                task.started_at = utc_now()
                return task
        return None

    def complete(self, task_id: str, result: dict[str, Any] | None = None, error: str | None = None) -> None:
        task = self._tasks.get(task_id)
        if not task:
            return
        task.finished_at = utc_now()
        task.result = result
        task.error = error
        task.status = TaskStatus.FAILED if error else TaskStatus.COMPLETED

    def list_tasks(self, limit: int = 50, status: TaskStatus | None = None) -> list[ResearchTask]:
        tasks = list(self._tasks.values())
        if status:
            tasks = [t for t in tasks if t.status == status]
        tasks.sort(key=lambda t: t.created_at, reverse=True)
        return tasks[:limit]

    def pending_count(self) -> int:
        return sum(1 for t in self._tasks.values() if t.status == TaskStatus.PENDING)

    def snapshot(self) -> list[dict[str, Any]]:
        return [t.model_dump(mode="json") for t in self.list_tasks(30)]


_queue: ResearchQueue | None = None


def get_research_queue() -> ResearchQueue:
    global _queue
    if _queue is None:
        _queue = ResearchQueue()
    return _queue
