"""Phased Binance Vision download queue with per-symbol progress tracking."""

from __future__ import annotations

import json
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.core.logging import get_logger
from app.market_data.constants import INSTITUTIONAL_MTF, MIN_BARS
from app.market_data.manager import MarketDataManager
from app.market_data.paths import market_data_root
from app.market_data.symbol_universe import (
    get_ranked_futures_universe,
    is_symbol_blacklisted,
    symbol_blacklist,
    universe_size,
)

logger = get_logger("market_data.queue")

PHASE_SIZE = int(__import__("os").getenv("MARKET_DATA_PHASE_SIZE", "50"))
# Only these statuses are picked for archive download — avoids infinite retry on partial symbols.
WORKER_STATUSES = ("pending", "running")
# Throttle disk scans when dashboard polls /jobs/progress (was 199×4 parquet reads per poll).
REFRESH_INTERVAL_SEC = float(__import__("os").getenv("MARKET_DATA_REFRESH_INTERVAL_SEC", "45"))


@dataclass
class TimeframeProgress:
    timeframe: str
    total_months: int = 0
    completed_months: int = 0
    converted: int = 0
    bars: int = 0
    min_bars: int = 100
    ready: bool = False
    fresh: bool = False
    status: str = "pending"
    pct: float = 0.0
    message: str = ""


@dataclass
class SymbolProgress:
    symbol: str
    status: str = "pending"
    overall_pct: float = 0.0
    timeframes: dict[str, TimeframeProgress] = field(default_factory=dict)
    message: str = ""
    updated_at: str = ""


@dataclass
class PhaseJob:
    phase: int
    symbols: list[str]
    status: str = "queued"
    overall_pct: float = 0.0
    symbols_complete: int = 0
    symbols_total: int = 0
    started_at: str | None = None
    finished_at: str | None = None
    symbol_progress: dict[str, SymbolProgress] = field(default_factory=dict)


@dataclass
class QueueState:
    job_id: str = ""
    auto_download: bool = False
    auto_update: bool = False
    paused: bool = False
    phase_size: int = PHASE_SIZE
    total_phases: int = 1
    current_phase: int = 0
    global_status: str = "idle"
    global_pct: float = 0.0
    universe_size: int = 0
    phases: list[PhaseJob] = field(default_factory=list)
    updated_at: str = ""
    last_error: str = ""


def _now_iso() -> str:
    return datetime.now(tz=UTC).isoformat()


def _build_phases(symbols: list[str], phase_size: int) -> list[PhaseJob]:
    phases: list[PhaseJob] = []
    chunks = [symbols[i : i + phase_size] for i in range(0, len(symbols), phase_size)]
    for idx, chunk in enumerate(chunks, start=1):
        sym_progress = {}
        for sym in chunk:
            tfs = {
                tf: TimeframeProgress(timeframe=tf, min_bars=MIN_BARS.get(tf, 100))
                for tf in INSTITUTIONAL_MTF
            }
            sym_progress[sym] = SymbolProgress(symbol=sym, timeframes=tfs)
        phases.append(
            PhaseJob(
                phase=idx,
                symbols=chunk,
                symbols_total=len(chunk),
                symbol_progress=sym_progress,
            )
        )
    return phases


def _calc_symbol_pct(sp: SymbolProgress) -> float:
    if not sp.timeframes:
        return 0.0
    return round(sum(tf.pct for tf in sp.timeframes.values()) / len(sp.timeframes), 1)


def _calc_phase_pct(phase: PhaseJob) -> float:
    if not phase.symbol_progress:
        return 0.0
    return round(sum(s.overall_pct for s in phase.symbol_progress.values()) / len(phase.symbol_progress), 1)


class MarketDataDownloadQueue:
    """Background phased archive downloader — 50 symbols per phase."""

    def __init__(self, universe: list[str] | None = None) -> None:
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._manager = MarketDataManager(workers=4)
        self._target_size = universe_size()
        self._universe = [s.upper() for s in (universe or self._resolve_universe())]
        self._state_path = market_data_root() / "_state" / "download_queue.json"
        self._state = self._load_state()
        self._last_refresh_at = 0.0
        self._heal_stuck_symbols(self._state)

    def _heal_stuck_symbols(self, state: QueueState) -> None:
        """Unstick symbols stuck in running/partial (e.g. BSBUSDT 404 loop before fix)."""
        blocked = symbol_blacklist()
        changed = False
        for phase in state.phases:
            for sym, sp in phase.symbol_progress.items():
                if sym in blocked and sp.status != "complete":
                    sp.status = "skipped"
                    sp.message = "Blacklisted — no usable Binance Vision archives"
                    sp.overall_pct = 100.0
                    for tfp in sp.timeframes.values():
                        tfp.status = "skipped"
                        tfp.pct = 100.0
                        tfp.message = sp.message
                    changed = True
                elif sp.status in ("partial", "running") and sp.overall_pct > 0:
                    sp.status = "awaiting_ws"
                    if not sp.message:
                        sp.message = "Archives ingested — live WS fills current month"
                    changed = True
        if changed:
            self._save_state()

    def _resolve_universe(self) -> list[str]:
        return get_ranked_futures_universe(limit=self._target_size)

    def _rebuild_phases(self, state: QueueState, symbols: list[str]) -> QueueState:
        old_progress: dict[str, SymbolProgress] = {}
        for phase in state.phases:
            old_progress.update(phase.symbol_progress)

        phases = _build_phases(symbols, PHASE_SIZE)
        for phase in phases:
            for sym in phase.symbols:
                if sym in old_progress:
                    phase.symbol_progress[sym] = old_progress[sym]

        state.phases = phases
        state.total_phases = len(phases)
        state.universe_size = len(symbols)
        state.updated_at = _now_iso()
        return state

    def _align_universe(self, state: QueueState) -> QueueState:
        fresh = self._resolve_universe()
        self._universe = fresh
        existing = [sym for phase in state.phases for sym in phase.symbols]
        expected_phases = max(1, (len(fresh) + PHASE_SIZE - 1) // PHASE_SIZE)

        if len(fresh) < self._target_size and len(existing) >= len(fresh):
            logger.warning(
                "Universe fetch returned %d symbols (target %d) — keeping saved queue",
                len(fresh),
                self._target_size,
            )
            return state

        if existing == fresh and len(state.phases) == expected_phases:
            return state
        logger.info(
            "Expanding download universe %d → %d symbols (%d phases)",
            len(existing),
            len(fresh),
            expected_phases,
        )
        return self._rebuild_phases(state, fresh)

    def _load_state(self) -> QueueState:
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        if self._state_path.exists():
            try:
                raw = json.loads(self._state_path.read_text(encoding="utf-8"))
                state = self._dict_to_state(raw)
                return self._align_universe(state)
            except Exception as exc:
                logger.warning("Queue state load failed: %s", exc)
        phases = _build_phases(self._universe, PHASE_SIZE)
        return QueueState(
            job_id=str(uuid.uuid4())[:8],
            total_phases=len(phases),
            universe_size=len(self._universe),
            phases=phases,
            updated_at=_now_iso(),
        )

    def _save_state(self) -> None:
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        self._state.updated_at = _now_iso()
        self._state_path.write_text(
            json.dumps(self._state_to_dict(self._state), indent=2),
            encoding="utf-8",
        )

    def _state_to_dict(self, state: QueueState) -> dict[str, Any]:
        def tf_dict(tf: TimeframeProgress) -> dict:
            return asdict(tf)

        def sym_dict(sp: SymbolProgress) -> dict:
            return {
                "symbol": sp.symbol,
                "status": sp.status,
                "overall_pct": sp.overall_pct,
                "message": sp.message,
                "updated_at": sp.updated_at,
                "timeframes": {k: tf_dict(v) for k, v in sp.timeframes.items()},
            }

        return {
            "job_id": state.job_id,
            "auto_download": state.auto_download,
            "auto_update": state.auto_update,
            "paused": state.paused,
            "phase_size": state.phase_size,
            "total_phases": state.total_phases,
            "current_phase": state.current_phase,
            "global_status": state.global_status,
            "global_pct": state.global_pct,
            "universe_size": state.universe_size,
            "last_error": state.last_error,
            "updated_at": state.updated_at,
            "phases": [
                {
                    "phase": p.phase,
                    "symbols": p.symbols,
                    "status": p.status,
                    "overall_pct": p.overall_pct,
                    "symbols_complete": p.symbols_complete,
                    "symbols_total": p.symbols_total,
                    "started_at": p.started_at,
                    "finished_at": p.finished_at,
                    "symbol_progress": {k: sym_dict(v) for k, v in p.symbol_progress.items()},
                }
                for p in state.phases
            ],
        }

    def _dict_to_state(self, raw: dict) -> QueueState:
        phases = []
        for p in raw.get("phases", []):
            sym_progress = {}
            for sym, sp in (p.get("symbol_progress") or {}).items():
                tfs = {}
                for tf, td in (sp.get("timeframes") or {}).items():
                    tfs[tf] = TimeframeProgress(**{**td, "timeframe": tf})
                sym_progress[sym] = SymbolProgress(
                    symbol=sp.get("symbol", sym),
                    status=sp.get("status", "pending"),
                    overall_pct=float(sp.get("overall_pct", 0)),
                    message=sp.get("message", ""),
                    updated_at=sp.get("updated_at", ""),
                    timeframes=tfs,
                )
            phases.append(
                PhaseJob(
                    phase=int(p["phase"]),
                    symbols=list(p.get("symbols", [])),
                    status=p.get("status", "queued"),
                    overall_pct=float(p.get("overall_pct", 0)),
                    symbols_complete=int(p.get("symbols_complete", 0)),
                    symbols_total=int(p.get("symbols_total", 0)),
                    started_at=p.get("started_at"),
                    finished_at=p.get("finished_at"),
                    symbol_progress=sym_progress,
                )
            )
        return QueueState(
            job_id=raw.get("job_id", str(uuid.uuid4())[:8]),
            auto_download=bool(raw.get("auto_download")),
            auto_update=bool(raw.get("auto_update")),
            paused=bool(raw.get("paused")),
            phase_size=int(raw.get("phase_size", PHASE_SIZE)),
            total_phases=int(raw.get("total_phases", len(phases))),
            current_phase=int(raw.get("current_phase", 0)),
            global_status=raw.get("global_status", "idle"),
            global_pct=float(raw.get("global_pct", 0)),
            universe_size=int(raw.get("universe_size", 0)),
            phases=phases,
            updated_at=raw.get("updated_at", _now_iso()),
            last_error=raw.get("last_error", ""),
        )

    def _progress_snapshot(self) -> dict[str, Any]:
        self._refresh_ready_symbols(force=True)
        self._state.global_pct = self._global_pct()
        return self._state_to_dict(self._state)

    def get_progress(self) -> dict[str, Any]:
        with self._lock:
            if self._state.global_status == "complete":
                self._state.global_pct = self._global_pct()
                return self._state_to_dict(self._state)
            current_idx = max(0, self._state.current_phase - 1)
            if self._state.phases:
                self._refresh_ready_symbols([self._state.phases[current_idx]])
            self._state.global_pct = self._global_pct()
            if self._state.last_error:
                sym_part = self._state.last_error.split(":", 1)[0].strip().upper()
                if is_symbol_blacklisted(sym_part):
                    self._state.last_error = ""
                    self._save_state()
            return self._state_to_dict(self._state)

    def _global_pct(self) -> float:
        if not self._state.phases:
            return 0.0
        done = sum(p.overall_pct for p in self._state.phases)
        return round(done / len(self._state.phases), 1)

    def _refresh_ready_symbols(
        self,
        phases: list[PhaseJob] | None = None,
        *,
        force: bool = False,
    ) -> None:
        now = time.time()
        if not force and (now - self._last_refresh_at) < REFRESH_INTERVAL_SEC:
            return
        self._last_refresh_at = now
        for phase in phases or self._state.phases:
            complete = 0
            for sym, sp in phase.symbol_progress.items():
                if sp.status in ("complete", "skipped"):
                    complete += 1
                    continue
                if sp.status == "awaiting_ws" and sp.overall_pct >= 99:
                    complete += 1
                    continue
                ready_count = 0
                for tf in INSTITUTIONAL_MTF:
                    st = self._manager.status(sym, tf)
                    tfp = sp.timeframes.get(tf) or TimeframeProgress(timeframe=tf)
                    tfp.bars = int(st.get("bars", 0))
                    tfp.min_bars = int(st.get("min_bars", MIN_BARS.get(tf, 100)))
                    tfp.ready = bool(st.get("ready")) or tfp.bars >= tfp.min_bars
                    tfp.fresh = bool(st.get("fresh"))
                    if tfp.bars >= tfp.min_bars:
                        tfp.status = "ready"
                        tfp.pct = 100.0
                        ready_count += 1
                    elif tfp.bars > 0:
                        tfp.pct = min(99.0, round(tfp.bars / max(tfp.min_bars, 1) * 100, 1))
                        tfp.status = "partial"
                    sp.timeframes[tf] = tfp
                sp.overall_pct = _calc_symbol_pct(sp)
                if ready_count == len(INSTITUTIONAL_MTF):
                    sp.status = "complete"
                    sp.overall_pct = 100.0
                    complete += 1
                elif sp.status in ("skipped", "awaiting_ws"):
                    complete += 1
                elif sp.status == "running":
                    pass
                sp.updated_at = _now_iso()
            phase.symbols_complete = complete
            phase.overall_pct = _calc_phase_pct(phase)
            if complete >= phase.symbols_total and phase.symbols_total > 0:
                if phase.status != "complete":
                    phase.status = "complete"
                    phase.finished_at = _now_iso()

    def configure_auto(self, *, auto_download: bool, auto_update: bool) -> dict:
        with self._lock:
            self._state.auto_download = auto_download
            self._state.auto_update = auto_update
            if auto_download and not self._state.paused:
                self._state.global_status = "running"
                self._ensure_worker()
            self._save_state()
            return self._progress_snapshot()

    def start_phase(self, phase: int | None = None) -> dict:
        with self._lock:
            target = phase or max(1, self._state.current_phase or 1)
            if target < 1 or target > len(self._state.phases):
                raise ValueError(f"Invalid phase {target}")
            self._state.current_phase = target
            job = self._state.phases[target - 1]
            job.status = "running"
            job.started_at = job.started_at or _now_iso()
            self._state.global_status = "running"
            self._state.paused = False
            self._ensure_worker()
            self._save_state()
            return self._progress_snapshot()

    def pause(self) -> dict:
        with self._lock:
            self._state.paused = True
            self._state.global_status = "paused"
            self._save_state()
            return self._progress_snapshot()

    def resume(self) -> dict:
        with self._lock:
            self._state.paused = False
            self._state.global_status = "running"
            self._ensure_worker()
            self._save_state()
            return self._progress_snapshot()

    def refresh_universe(self) -> dict:
        """Re-fetch top-N ranked pairs from Binance and rebuild phases (keeps progress)."""
        fresh = get_ranked_futures_universe(limit=self._target_size, force_refresh=True)
        with self._lock:
            self._universe = fresh
            self._state = self._rebuild_phases(self._state, fresh)
            self._save_state()
            return self._progress_snapshot()

    def reset_phase(self, phase: int) -> dict:
        with self._lock:
            job = self._state.phases[phase - 1]
            for sym in job.symbols:
                tfs = {
                    tf: TimeframeProgress(timeframe=tf, min_bars=MIN_BARS.get(tf, 100))
                    for tf in INSTITUTIONAL_MTF
                }
                job.symbol_progress[sym] = SymbolProgress(symbol=sym, timeframes=tfs)
            job.status = "queued"
            job.overall_pct = 0.0
            job.symbols_complete = 0
            job.started_at = None
            job.finished_at = None
            self._save_state()
            return self._progress_snapshot()

    def _ensure_worker(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._worker_loop, daemon=True, name="market-data-queue")
        self._thread.start()

    def _worker_loop(self) -> None:
        logger.info("Market data download worker started")
        while not self._stop.is_set():
            with self._lock:
                if self._state.paused:
                    self._save_state()
                    time.sleep(2)
                    continue
                if not self._state.auto_download and self._state.global_status not in ("running",):
                    time.sleep(2)
                    continue
                phase_idx = max(0, self._state.current_phase - 1)
                if phase_idx >= len(self._state.phases):
                    self._state.global_status = "complete"
                    self._save_state()
                    time.sleep(5)
                    continue
                phase = self._state.phases[phase_idx]

            if phase.status == "complete":
                with self._lock:
                    if self._state.auto_download and self._state.current_phase < len(self._state.phases):
                        self._state.current_phase += 1
                        next_phase = self._state.phases[self._state.current_phase - 1]
                        next_phase.status = "running"
                        next_phase.started_at = _now_iso()
                        self._save_state()
                    else:
                        self._state.global_status = "complete"
                        self._save_state()
                time.sleep(3)
                continue

            pending_sym = None
            with self._lock:
                phase.status = "running"
                for sym in phase.symbols:
                    sp = phase.symbol_progress[sym]
                    if sp.status in WORKER_STATUSES:
                        pending_sym = sym
                        sp.status = "running"
                        break

            if not pending_sym:
                with self._lock:
                    self._refresh_ready_symbols(force=True)
                    # Count skipped/blacklisted as done for phase progression
                    done_like = sum(
                        1
                        for sp in phase.symbol_progress.values()
                        if sp.status in ("complete", "awaiting_ws", "skipped")
                    )
                    if done_like >= phase.symbols_total and phase.symbols_total > 0:
                        phase.status = "complete"
                        phase.finished_at = phase.finished_at or _now_iso()
                    elif phase.status != "complete":
                        phase.status = "running"
                    self._save_state()
                time.sleep(3)
                continue

            self._process_symbol(phase, pending_sym)

        logger.info("Market data download worker stopped")

    def _finalize_symbol_status(self, sp: SymbolProgress) -> None:
        ready_count = sum(
            1 for tf in INSTITUTIONAL_MTF if sp.timeframes.get(tf) and sp.timeframes[tf].ready
        )
        if ready_count == len(INSTITUTIONAL_MTF):
            sp.status = "complete"
            sp.message = ""
            sp.overall_pct = 100.0
            return

        total_bars = sum(sp.timeframes[tf].bars for tf in INSTITUTIONAL_MTF if tf in sp.timeframes)
        no_archives = all(
            sp.timeframes.get(tf)
            and sp.timeframes[tf].bars == 0
            and sp.timeframes[tf].message == "no_archives"
            for tf in INSTITUTIONAL_MTF
        )

        if no_archives or (total_bars == 0 and is_symbol_blacklisted(sp.symbol)):
            sp.status = "skipped"
            sp.message = "No Binance Vision archives (new listing or blacklisted)"
            sp.overall_pct = 100.0
            return

        sp.status = "awaiting_ws"
        sp.message = "Archives ingested — live WS fills current month"
        sp.overall_pct = _calc_symbol_pct(sp)

    def _process_symbol(self, phase: PhaseJob, symbol: str) -> None:
        sp = phase.symbol_progress[symbol]

        if is_symbol_blacklisted(symbol):
            with self._lock:
                sp.status = "skipped"
                sp.message = "Blacklisted — no usable Binance Vision archives"
                sp.overall_pct = 100.0
                for tf in INSTITUTIONAL_MTF:
                    tfp = sp.timeframes[tf]
                    tfp.status = "skipped"
                    tfp.pct = 100.0
                    tfp.message = sp.message
                phase.overall_pct = _calc_phase_pct(phase)
                self._refresh_ready_symbols(force=True)
                self._save_state()
            return

        try:
            for tf in INSTITUTIONAL_MTF:
                with self._lock:
                    if self._state.paused:
                        return
                    tfp = sp.timeframes[tf]
                    tfp.status = "downloading"
                    self._save_state()

                result = self._manager.ingest_archives(symbol, tf)
                dl = result.get("download", {})
                st = result.get("status", {})

                with self._lock:
                    tfp = sp.timeframes[tf]
                    tfp.total_months = int(dl.get("total", 0))
                    tfp.completed_months = int(dl.get("completed", 0)) + int(dl.get("skipped", 0))
                    tfp.converted = int(result.get("converted", 0))
                    tfp.bars = int(st.get("bars", 0))
                    tfp.min_bars = int(st.get("min_bars", MIN_BARS.get(tf, 100)))
                    tfp.ready = bool(st.get("ready"))
                    tfp.fresh = bool(st.get("fresh"))
                    dl_missing = int(dl.get("missing", 0))
                    dl_total = int(dl.get("total", 0))
                    if tfp.bars == 0 and dl_total > 0 and dl_missing >= dl_total:
                        tfp.message = "no_archives"
                        tfp.status = "skipped"
                        tfp.pct = 100.0
                    elif tfp.ready:
                        tfp.status = "ready"
                        tfp.pct = 100.0
                    elif tfp.bars > 0:
                        tfp.pct = min(99.0, round(tfp.bars / max(tfp.min_bars, 1) * 100, 1))
                        tfp.status = "partial"
                    else:
                        tfp.pct = round((tfp.completed_months / max(tfp.total_months, 1)) * 80, 1)
                    sp.overall_pct = _calc_symbol_pct(sp)
                    phase.overall_pct = _calc_phase_pct(phase)
                    self._save_state()

            with self._lock:
                self._refresh_ready_symbols(force=True)
                self._finalize_symbol_status(sp)
                phase.overall_pct = _calc_phase_pct(phase)
                self._save_state()
        except Exception as exc:
            logger.exception("Symbol download failed %s", symbol)
            with self._lock:
                sp.status = "error"
                sp.message = str(exc)
                self._state.last_error = f"{symbol}: {exc}"
                self._save_state()

    def start_auto_if_enabled(self) -> None:
        import os

        if os.getenv("MARKET_DATA_AUTO_DOWNLOAD", "true").lower() not in ("1", "true", "yes"):
            return
        with self._lock:
            self._state.auto_download = True
            self._state.auto_update = os.getenv("MARKET_DATA_AUTO_UPDATE", "true").lower() in ("1", "true", "yes")
            if self._state.current_phase < 1:
                self._state.current_phase = 1
            self._state.global_status = "running"
            phase = self._state.phases[0]
            phase.status = "running"
            phase.started_at = phase.started_at or _now_iso()
            self._ensure_worker()
            self._save_state()
        logger.info("Auto-download phase 1 started (%d symbols)", len(self._state.phases[0].symbols))


_queue: MarketDataDownloadQueue | None = None


def get_download_queue() -> MarketDataDownloadQueue:
    global _queue
    if _queue is None:
        _queue = MarketDataDownloadQueue()
    return _queue
