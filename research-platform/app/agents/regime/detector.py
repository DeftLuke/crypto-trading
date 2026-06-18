"""Market regime detection."""

from __future__ import annotations

from typing import Any

import numpy as np


class RegimeDetector:
    def detect(self, candles_or_metrics: dict[str, Any] | None = None) -> dict[str, Any]:
        m = candles_or_metrics or {}
        trend = m.get("trend", "neutral")
        volatility = m.get("volatility", "normal")
        rsi = m.get("rsi14", m.get("rsi", 50))

        if isinstance(rsi, (int, float)):
            if rsi > 60:
                bias = "bearish_reversal_zone" if rsi > 70 else "bullish_momentum"
            elif rsi < 40:
                bias = "bullish_reversal_zone" if rsi < 30 else "bearish_momentum"
            else:
                bias = "neutral"
        else:
            bias = "neutral"

        atr_pct = m.get("atr_pct", m.get("volatility_pct", 1.0))
        try:
            atr_pct = float(atr_pct)
        except (TypeError, ValueError):
            atr_pct = 1.0

        if atr_pct > 2.5:
            vol_regime = "high_volatility"
        elif atr_pct < 0.8:
            vol_regime = "low_volatility"
        else:
            vol_regime = "normal_volatility"

        if trend in ("up", "bullish", "bull"):
            trend_regime = "trending_bullish"
        elif trend in ("down", "bearish", "bear"):
            trend_regime = "trending_bearish"
        else:
            trend_regime = "ranging"

        label = f"{trend_regime}_{vol_regime}"
        return {
            "regime": label,
            "trend": trend_regime,
            "volatility": vol_regime,
            "bias": bias,
            "labels": [trend_regime, vol_regime, bias],
        }

    def from_closes(self, closes: list[float]) -> dict[str, Any]:
        if len(closes) < 20:
            return self.detect()
        arr = np.array(closes[-50:])
        returns = np.diff(arr) / arr[:-1]
        vol = float(np.std(returns) * 100) if len(returns) else 1.0
        sma20 = float(np.mean(arr[-20:]))
        sma50 = float(np.mean(arr[-min(50, len(arr)):]))
        trend = "bullish" if sma20 > sma50 * 1.002 else "bearish" if sma20 < sma50 * 0.998 else "neutral"
        return self.detect({"trend": trend, "volatility_pct": vol, "rsi14": 50})
