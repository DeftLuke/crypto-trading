"""Meta-learning — predict strategy success before backtest."""

from __future__ import annotations

from typing import Any

import numpy as np

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger("agents.meta.predictor")


class MetaLearningPredictor:
    """Heuristic + optional XGBoost/LightGBM for pre-backtest filtering."""

    FEATURE_NAMES = [
        "num_conditions",
        "has_rsi",
        "has_bos",
        "has_ob",
        "has_session",
        "direction_short",
        "memory_win_rate",
        "pattern_confidence",
    ]

    def __init__(self) -> None:
        self._model = None
        self._use_ml = False
        self._init_model()

    def _init_model(self) -> None:
        settings = get_settings()
        if settings.agent_low_ram or not settings.agent_meta_learning:
            return
        try:
            from sklearn.ensemble import GradientBoostingClassifier

            self._model = GradientBoostingClassifier(n_estimators=50, max_depth=4, random_state=42)
            self._use_ml = True
            self._fit_bootstrap()
        except ImportError:
            logger.info("sklearn unavailable — using heuristic meta scorer")

    def _fit_bootstrap(self) -> None:
        if not self._model:
            return
        X, y = [], []
        for n in range(2, 6):
            for wr in (45, 55, 65, 75):
                for has_bos in (0, 1):
                    X.append([n, 1, has_bos, 1, 0, 1, wr, 0.6])
                    y.append(1 if wr >= 60 and has_bos else 0)
        self._model.fit(np.array(X), np.array(y))

    def featurize(self, strategy: dict[str, Any], memory_context: dict[str, Any] | None = None) -> list[float]:
        conditions = strategy.get("conditions") or []
        text = " ".join(conditions).lower()
        ctx = memory_context or {}
        wins = ctx.get("winning_setups", [])
        win_rate = 50.0
        if wins:
            win_rate = sum(1 for w in wins if (w.get("result") or "").upper() == "WIN") / len(wins) * 100

        patterns = ctx.get("patterns", [])
        pat_conf = 0.5
        if patterns:
            pat_conf = float(patterns[0].get("win_rate") or 50) / 100

        return [
            len(conditions),
            1.0 if "rsi" in text else 0.0,
            1.0 if "bos" in text else 0.0,
            1.0 if "ob" in text else 0.0,
            1.0 if strategy.get("session_filter") else 0.0,
            1.0 if strategy.get("direction", "SHORT") == "SHORT" else 0.0,
            win_rate,
            pat_conf,
        ]

    def predict(self, strategy: dict[str, Any], memory_context: dict[str, Any] | None = None) -> dict[str, float]:
        features = self.featurize(strategy, memory_context)
        if self._use_ml and self._model is not None:
            prob = float(self._model.predict_proba([features])[0][1])
        else:
            prob = self._heuristic(features)

        return {
            "success_probability": round(prob, 4),
            "expected_profit_factor": round(1.0 + prob * 2.5, 3),
            "expected_drawdown": round(max(5.0, 25.0 - prob * 18), 2),
        }

    def _heuristic(self, features: list[float]) -> float:
        n, rsi, bos, ob, sess, short, wr, pat = features
        score = 0.35
        score += 0.08 * min(n, 5)
        score += 0.12 * rsi + 0.15 * bos + 0.10 * ob
        score += 0.05 * sess
        score += (wr / 100) * 0.15
        score += pat * 0.10
        return min(0.95, max(0.05, score))
