"""Production SMC engine — BOS, CHOCH, FVG, OB, liquidity, sweeps."""

from __future__ import annotations

import polars as pl

from app.smc.swings import find_swings
from app.smc.types import (
    Direction,
    LiquidityType,
    SmcAnalysisResult,
    SmcBarOutput,
    Zone,
    ZoneType,
)
from app.smc.zones import ZoneStateEngine


class SmcEngine:
    """Smart Money Concepts detection engine."""

    def __init__(
        self,
        swing_lookback: int = 3,
        eq_tolerance_pct: float = 0.001,
        min_impulse_pct: float = 0.003,
    ) -> None:
        self.swing_lookback = swing_lookback
        self.eq_tolerance_pct = eq_tolerance_pct
        self.min_impulse_pct = min_impulse_pct

    def analyze(self, df: pl.DataFrame) -> SmcAnalysisResult:
        if df.is_empty():
            return SmcAnalysisResult([], [], [], [])

        df = df.sort("ts")
        ts_list = df["ts"].to_list()
        opens = df["open"].to_list()
        highs = df["high"].to_list()
        lows = df["low"].to_list()
        closes = df["close"].to_list()
        n = len(ts_list)

        swing_highs, swing_lows = find_swings(highs, lows, ts_list, self.swing_lookback)
        zone_engine = ZoneStateEngine()
        bars: list[SmcBarOutput] = []
        trend: Direction = Direction.NEUTRAL
        last_sh_idx = -1
        last_sl_idx = -1
        sh_ptr, sl_ptr = 0, 0

        for i in range(n):
            out = SmcBarOutput(ts=ts_list[i])
            while sh_ptr < len(swing_highs) and swing_highs[sh_ptr].index <= i:
                last_sh_idx = swing_highs[sh_ptr].index
                sh_ptr += 1
            while sl_ptr < len(swing_lows) and swing_lows[sl_ptr].index <= i:
                last_sl_idx = swing_lows[sl_ptr].index
                sl_ptr += 1

            # BOS / CHOCH
            if last_sh_idx >= 0 and closes[i] > highs[last_sh_idx]:
                if trend == Direction.BEARISH:
                    out.choch = True
                    out.choch_type = Direction.BULLISH.value
                else:
                    out.bos = True
                    out.bos_type = Direction.BULLISH.value
                trend = Direction.BULLISH
                out.structure_bias = Direction.BULLISH.value
            if last_sl_idx >= 0 and closes[i] < lows[last_sl_idx]:
                if trend == Direction.BULLISH:
                    out.choch = True
                    out.choch_type = Direction.BEARISH.value
                else:
                    out.bos = True
                    out.bos_type = Direction.BEARISH.value
                trend = Direction.BEARISH
                out.structure_bias = Direction.BEARISH.value

            # Fair Value Gap (3-candle)
            if i >= 2:
                if lows[i] > highs[i - 2]:
                    out.fvg = True
                    out.fvg_direction = Direction.BULLISH.value
                    out.fvg_bottom = highs[i - 2]
                    out.fvg_top = lows[i]
                    zone_engine.add_zone(Zone(
                        ZoneType.FVG, Direction.BULLISH,
                        out.fvg_top, out.fvg_bottom, ts_list[i], index=i,
                    ))
                elif highs[i] < lows[i - 2]:
                    out.fvg = True
                    out.fvg_direction = Direction.BEARISH.value
                    out.fvg_top = lows[i - 2]
                    out.fvg_bottom = highs[i]
                    zone_engine.add_zone(Zone(
                        ZoneType.FVG, Direction.BEARISH,
                        out.fvg_top, out.fvg_bottom, ts_list[i], index=i,
                    ))

            # Order Block — last opposing candle before impulse
            if i >= 2:
                move_pct = abs(closes[i] - closes[i - 1]) / closes[i - 1] if closes[i - 1] else 0
                if move_pct >= self.min_impulse_pct:
                    if closes[i] > closes[i - 1] and closes[i - 1] < opens[i - 1]:
                        out.order_block = True
                        out.ob_direction = Direction.BULLISH.value
                        out.ob_high = highs[i - 1]
                        out.ob_low = lows[i - 1]
                        zone_engine.add_zone(Zone(
                            ZoneType.OB, Direction.BULLISH,
                            out.ob_high, out.ob_low, ts_list[i - 1], index=i - 1,
                        ))
                    elif closes[i] < closes[i - 1] and closes[i - 1] > opens[i - 1]:
                        out.order_block = True
                        out.ob_direction = Direction.BEARISH.value
                        out.ob_high = highs[i - 1]
                        out.ob_low = lows[i - 1]
                        zone_engine.add_zone(Zone(
                            ZoneType.OB, Direction.BEARISH,
                            out.ob_high, out.ob_low, ts_list[i - 1], index=i - 1,
                        ))

            # Equal highs / lows liquidity
            for sh in swing_highs:
                if sh.index >= i:
                    break
                if abs(highs[i] - sh.price) / sh.price <= self.eq_tolerance_pct:
                    out.liquidity_type = LiquidityType.EQUAL_HIGHS.value
            for sl in swing_lows:
                if sl.index >= i:
                    break
                if abs(lows[i] - sl.price) / sl.price <= self.eq_tolerance_pct:
                    out.liquidity_type = LiquidityType.EQUAL_LOWS.value

            # External liquidity (most recent swing)
            if swing_highs:
                out.external_structure = "high" if highs[i] >= swing_highs[-1].price * 0.999 else None
            if swing_lows:
                out.internal_structure = "low" if lows[i] <= swing_lows[-1].price * 1.001 else None

            # Liquidity sweep
            if last_sh_idx >= 0 and highs[i] > highs[last_sh_idx] and closes[i] < highs[last_sh_idx]:
                out.liquidity_sweep = True
                out.sweep_direction = "sellside"
            if last_sl_idx >= 0 and lows[i] < lows[last_sl_idx] and closes[i] > lows[last_sl_idx]:
                out.liquidity_sweep = True
                out.sweep_direction = "buyside"

            zone_engine.update(highs[i], lows[i], closes[i], ts_list[i])
            bars.append(out)

        return SmcAnalysisResult(bars, zone_engine.zones, swing_highs, swing_lows)

    def detect(self, candles: list[dict]) -> list[SmcBarOutput]:
        """Protocol-compatible wrapper."""
        if not candles:
            return []
        df = pl.DataFrame(candles)
        return self.analyze(df).bars
