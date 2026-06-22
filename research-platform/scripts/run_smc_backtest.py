#!/usr/bin/env python3
"""CLI runner for SMC backtest — emits progress JSON lines + final result on stdout."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


async def main() -> int:
    p = argparse.ArgumentParser(description="TradeGPT SMC-MTF Backtest")
    p.add_argument("--symbol", default="BTCUSDT")
    p.add_argument("--timeframe", default="15m")
    p.add_argument("--period", default="3m")
    p.add_argument("--capital", type=float, default=10_000)
    args = p.parse_args()

    from app.services.smc_backtest_service import SmcBacktestService

    service = SmcBacktestService()

    def on_progress(pct: float, phase: str, message: str) -> None:
        emit({"type": "progress", "progress_pct": pct, "phase": phase, "message": message})

    try:
        result = await service.run(
            args.symbol.upper(),
            args.timeframe,
            args.period,
            args.capital,
            on_progress=on_progress,
        )
        emit({"type": "result", "ok": True, "data": result})
        return 0
    except Exception as exc:
        emit({"type": "error", "ok": False, "error": str(exc)})
        return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
