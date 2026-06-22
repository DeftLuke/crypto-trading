"""Parameter optimization for E5 institutional strategy."""

from __future__ import annotations

import itertools
from copy import deepcopy
from typing import Any

from app.backtest.config import BacktestConfig
from app.strategies.e5_institutional.engine import E5InstitutionalEngine


def optimize_e5(
    config: BacktestConfig,
    symbol: str = "BTCUSDT",
    ema_fast_range: tuple[int, ...] = (15, 20, 25),
    atr_range: tuple[int, ...] = (10, 14, 20),
    score_range: tuple[int, ...] = (80, 85, 90),
    max_trials: int = 36,
) -> dict[str, Any]:
    combos = list(itertools.product(ema_fast_range, atr_range, score_range))[:max_trials]
    best: dict[str, Any] = {"score": -1, "params": {}, "metrics": {}}

    for ema_fast, atr_p, score_th in combos:
        cfg = deepcopy(config)
        cfg.symbols = [symbol]
        cfg.min_confidence = float(score_th)
        cfg.config_json = cfg.to_dict()
        cfg.config_json["ema_fast"] = ema_fast
        cfg.config_json["atr_period"] = atr_p

        eng = E5InstitutionalEngine(cfg)
        result = eng.run_symbol(symbol)
        m = result.metrics
        trial_score = float(m.get("profit_factor", 0)) * float(m.get("win_rate", 0)) / 100
        if trial_score > best["score"]:
            best = {
                "score": trial_score,
                "params": {"ema_fast": ema_fast, "atr_period": atr_p, "score_threshold": score_th},
                "metrics": m,
            }

    return best
