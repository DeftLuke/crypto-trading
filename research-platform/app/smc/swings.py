"""Swing high/low detection."""

from app.smc.types import SwingPoint


def find_swings(
    highs: list[float],
    lows: list[float],
    ts_list: list[int],
    lookback: int = 3,
) -> tuple[list[SwingPoint], list[SwingPoint]]:
    swing_highs: list[SwingPoint] = []
    swing_lows: list[SwingPoint] = []
    n = len(highs)
    for i in range(lookback, n - lookback):
        if all(highs[i] >= highs[i - j] for j in range(1, lookback + 1)) and all(
            highs[i] >= highs[i + j] for j in range(1, lookback + 1)
        ):
            swing_highs.append(SwingPoint(i, ts_list[i], highs[i], "high"))
        if all(lows[i] <= lows[i - j] for j in range(1, lookback + 1)) and all(
            lows[i] <= lows[i + j] for j in range(1, lookback + 1)
        ):
            swing_lows.append(SwingPoint(i, ts_list[i], lows[i], "low"))
    return swing_highs, swing_lows
