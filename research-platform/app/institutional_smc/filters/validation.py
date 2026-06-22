"""CP5 validation filters — EMA, RSI, MACD, volume/OI, volatility."""

from __future__ import annotations

from dataclasses import dataclass, field

import polars as pl

from app.institutional_smc.constants import EMA_PERIODS, RejectionCode, SCORE_WEIGHTS
from app.institutional_smc.filters.indicators import (
    atr_series,
    ema_series,
    macd_hist_series,
    rsi_series,
    volume_ma,
)
from app.institutional_smc.modules.premium_discount import PriceZone, PremiumDiscountSnapshot
from app.institutional_smc.types import FilterResult, ModuleStatus

HARD_FILTER_NAMES: frozenset[str] = frozenset({
    "htf_alignment",
    "premium_discount",
    "ema_alignment",
    "rsi",
    "macd",
    "volatility",
    "volume_oi",
})

FILTER_REJECTION_CODES: dict[str, str] = {
    "htf_alignment": RejectionCode.HTF_MISALIGNMENT,
    "premium_discount": RejectionCode.PREMIUM_DISCOUNT_VIOLATION,
    "ema_alignment": RejectionCode.EMA_TREND_FAIL,
    "rsi": RejectionCode.RSI_FAIL,
    "macd": RejectionCode.MACD_FAIL,
    "volatility": RejectionCode.VOLATILITY_CHOP,
    "volume_oi": RejectionCode.VOLUME_OI_WEAK,
}


@dataclass(kw_only=True)
class ValidationSnapshot:
    filters: list[FilterResult] = field(default_factory=list)
    ema_alignment: float = 0.0
    rsi_macd: float = 0.0
    volatility: float = 0.0
    volume_oi: float = 0.0

    @property
    def hard_fail_codes(self) -> list[str]:
        codes: list[str] = []
        for f in self.filters:
            if f.status == ModuleStatus.FAIL and f.name in HARD_FILTER_NAMES:
                code = FILTER_REJECTION_CODES.get(f.name)
                if code:
                    codes.append(code)
        return codes

    def to_explanation_list(self) -> list[FilterResult]:
        return self.filters


class ValidationFilterEngine:
    """Run institutional validation filters and produce score contributions."""

    def evaluate(
        self,
        direction: str,
        *,
        mtf_aligned: bool,
        setup_df: pl.DataFrame | None,
        entry_df: pl.DataFrame | None,
        pd_snap: PremiumDiscountSnapshot | None = None,
        oi_data_available: bool = False,
    ) -> ValidationSnapshot:
        filters: list[FilterResult] = []
        ema_score = 0.0
        rsi_macd_score = 0.0
        vol_score = 0.0
        volume_score = 0.0

        filters.append(self._htf_filter(mtf_aligned, direction))

        pd_filter, pd_ok = self._premium_discount_filter(direction, pd_snap)
        filters.append(pd_filter)

        if setup_df is not None and not setup_df.is_empty():
            ema_filter, ema_score = self._ema_filter(direction, setup_df)
            filters.append(ema_filter)
        else:
            filters.append(FilterResult(
                name="ema_alignment", status=ModuleStatus.FAIL, score=0.0, reason="Missing setup timeframe data",
            ))

        if entry_df is not None and not entry_df.is_empty():
            rsi_filter, macd_filter, rsi_macd_score = self._rsi_macd_filters(direction, entry_df)
            vol_filter, vol_score = self._volatility_filter(entry_df)
            vol_oi_filter, volume_score = self._volume_oi_filter(entry_df, oi_data_available)
            filters.extend([rsi_filter, macd_filter, vol_filter, vol_oi_filter])
        else:
            filters.extend([
                FilterResult(name="rsi", status=ModuleStatus.FAIL, reason="Missing entry timeframe data"),
                FilterResult(name="macd", status=ModuleStatus.FAIL, reason="Missing entry timeframe data"),
                FilterResult(name="volatility", status=ModuleStatus.FAIL, reason="Missing entry timeframe data"),
                FilterResult(name="volume_oi", status=ModuleStatus.FAIL, reason="Missing entry timeframe data"),
            ])

        return ValidationSnapshot(
            filters=filters,
            ema_alignment=ema_score,
            rsi_macd=rsi_macd_score,
            volatility=vol_score,
            volume_oi=volume_score,
        )

    def _htf_filter(self, mtf_aligned: bool, direction: str) -> FilterResult:
        if direction == "IGNORE":
            return FilterResult(
                name="htf_alignment",
                status=ModuleStatus.FAIL,
                reason="No direction — HTF/LTF alignment not evaluable",
            )
        if mtf_aligned:
            return FilterResult(
                name="htf_alignment",
                status=ModuleStatus.PASS,
                score=0.0,
                reason="1D and 4H structure aligned with trade direction",
            )
        return FilterResult(
            name="htf_alignment",
            status=ModuleStatus.FAIL,
            reason="1D/4H structure not aligned — HTF gate failed",
        )

    def _premium_discount_filter(
        self,
        direction: str,
        pd_snap: PremiumDiscountSnapshot | None,
    ) -> tuple[FilterResult, bool]:
        if direction == "IGNORE" or pd_snap is None or pd_snap.bar_count == 0:
            return FilterResult(
                name="premium_discount",
                status=ModuleStatus.PARTIAL,
                reason="Premium/discount not evaluated",
            ), False

        is_long = direction.upper() in ("LONG", "BUY")
        aligned = (is_long and pd_snap.zone == PriceZone.DISCOUNT) or (
            not is_long and pd_snap.zone == PriceZone.PREMIUM
        )
        neutral = pd_snap.zone == PriceZone.EQUILIBRIUM

        if aligned:
            return FilterResult(
                name="premium_discount",
                status=ModuleStatus.PASS,
                score=pd_snap.pd_score_component(direction),
                reason=f"Price in {pd_snap.zone.value} zone ({pd_snap.position_pct:.1f}% of range)",
                details=pd_snap.to_dict(),
            ), True
        if neutral:
            return FilterResult(
                name="premium_discount",
                status=ModuleStatus.PARTIAL,
                score=pd_snap.pd_score_component(direction),
                reason=f"Price at equilibrium ({pd_snap.position_pct:.1f}%)",
                details=pd_snap.to_dict(),
            ), False
        return FilterResult(
            name="premium_discount",
            status=ModuleStatus.FAIL,
            score=pd_snap.pd_score_component(direction),
            reason=f"Wrong zone for {direction}: {pd_snap.zone.value} ({pd_snap.position_pct:.1f}%)",
            details=pd_snap.to_dict(),
        ), False

    def _ema_filter(self, direction: str, df: pl.DataFrame) -> tuple[FilterResult, float]:
        df = df.sort("ts")
        closes = df["close"].to_list()
        if len(closes) < max(EMA_PERIODS):
            return FilterResult(
                name="ema_alignment", status=ModuleStatus.FAIL, reason="Insufficient bars for EMA200",
            ), 0.0

        ema21 = ema_series(closes, 21)[-1]
        ema50 = ema_series(closes, 50)[-1]
        ema200 = ema_series(closes, 200)[-1]
        close = closes[-1]
        is_long = direction.upper() in ("LONG", "BUY")

        checks = 0
        if is_long:
            if close > ema21:
                checks += 1
            if ema21 > ema50:
                checks += 1
            if close > ema200:
                checks += 1
            if ema50 > ema200:
                checks += 1
            hard_ok = close > ema200
        else:
            if close < ema21:
                checks += 1
            if ema21 < ema50:
                checks += 1
            if close < ema200:
                checks += 1
            if ema50 < ema200:
                checks += 1
            hard_ok = close < ema200

        score = (checks / 4.0) * SCORE_WEIGHTS.ema_alignment
        details = {"ema21": round(ema21, 4), "ema50": round(ema50, 4), "ema200": round(ema200, 4), "close": close}

        if not hard_ok:
            return FilterResult(
                name="ema_alignment",
                status=ModuleStatus.FAIL,
                score=score,
                reason=f"Price on wrong side of EMA200 for {direction}",
                details=details,
            ), score
        if checks >= 3:
            return FilterResult(
                name="ema_alignment",
                status=ModuleStatus.PASS,
                score=score,
                reason=f"EMA 21/50/200 stack aligned ({checks}/4)",
                details=details,
            ), score
        return FilterResult(
            name="ema_alignment",
            status=ModuleStatus.PARTIAL,
            score=score,
            reason=f"Partial EMA alignment ({checks}/4)",
            details=details,
        ), score

    def _rsi_macd_filters(
        self,
        direction: str,
        df: pl.DataFrame,
    ) -> tuple[FilterResult, FilterResult, float]:
        closes = df.sort("ts")["close"].to_list()
        rsi_vals = rsi_series(closes, 14)
        macd_hist = macd_hist_series(closes)
        rsi = rsi_vals[-1] if rsi_vals else 50.0
        hist = macd_hist[-1] if macd_hist else 0.0
        is_long = direction.upper() in ("LONG", "BUY")
        max_each = SCORE_WEIGHTS.rsi_macd / 2.0

        if is_long:
            rsi_ok = rsi > 50.0
            macd_ok = hist > 0
        else:
            rsi_ok = rsi < 50.0
            macd_ok = hist < 0

        rsi_score = max_each if rsi_ok else max_each * 0.2
        macd_score = max_each if macd_ok else max_each * 0.2

        rsi_filter = FilterResult(
            name="rsi",
            status=ModuleStatus.PASS if rsi_ok else ModuleStatus.FAIL,
            score=rsi_score,
            reason=f"RSI14={rsi:.1f} ({'pass' if rsi_ok else 'fail'} for {direction})",
            details={"rsi": round(rsi, 2)},
        )
        macd_filter = FilterResult(
            name="macd",
            status=ModuleStatus.PASS if macd_ok else ModuleStatus.FAIL,
            score=macd_score,
            reason=f"MACD hist={hist:.4f} ({'pass' if macd_ok else 'fail'} for {direction})",
            details={"macd_hist": round(hist, 6)},
        )
        return rsi_filter, macd_filter, rsi_score + macd_score

    def _volatility_filter(self, df: pl.DataFrame) -> tuple[FilterResult, float]:
        df = df.sort("ts")
        highs = df["high"].to_list()
        lows = df["low"].to_list()
        closes = df["close"].to_list()
        if len(closes) < 50:
            return FilterResult(
                name="volatility", status=ModuleStatus.PARTIAL, score=2.0, reason="Limited data for ATR50",
            ), 2.0

        atr14 = atr_series(highs, lows, closes, 14)
        atr50 = atr_series(highs, lows, closes, 50)
        a14 = atr14[-1] if atr14 else 0.0
        a50 = atr50[-1] if atr50 else 0.0
        ratio = a14 / a50 if a50 > 0 else 1.0

        if ratio < 0.45:
            return FilterResult(
                name="volatility",
                status=ModuleStatus.FAIL,
                score=0.0,
                reason=f"ATR14/ATR50={ratio:.2f} — compression/chop",
                details={"atr14": round(a14, 6), "atr50": round(a50, 6), "ratio": round(ratio, 3)},
            ), 0.0
        if 0.7 <= ratio <= 1.8:
            score = SCORE_WEIGHTS.volatility
            status = ModuleStatus.PASS
            reason = f"Healthy volatility expansion (ratio={ratio:.2f})"
        elif ratio < 0.7:
            score = SCORE_WEIGHTS.volatility * 0.5
            status = ModuleStatus.PARTIAL
            reason = f"Mild compression (ratio={ratio:.2f})"
        else:
            score = SCORE_WEIGHTS.volatility * 0.6
            status = ModuleStatus.PARTIAL
            reason = f"Elevated volatility (ratio={ratio:.2f})"

        return FilterResult(
            name="volatility",
            status=status,
            score=score,
            reason=reason,
            details={"atr14": round(a14, 6), "atr50": round(a50, 6), "ratio": round(ratio, 3)},
        ), score

    def _volume_oi_filter(self, df: pl.DataFrame, oi_data_available: bool) -> tuple[FilterResult, float]:
        df = df.sort("ts")
        volumes = df["volume"].to_list() if "volume" in df.columns else []
        if not volumes:
            return FilterResult(
                name="volume_oi", status=ModuleStatus.PARTIAL, score=5.0, reason="Volume data unavailable",
            ), 5.0

        avg = volume_ma(volumes, 20)
        current = volumes[-1]
        ratio = current / avg if avg > 0 else 1.0

        if ratio >= 1.2:
            vol_part = SCORE_WEIGHTS.volume_oi * 0.7
            status = ModuleStatus.PASS
            reason = f"Volume spike {ratio:.2f}x average"
        elif ratio >= 0.9:
            vol_part = SCORE_WEIGHTS.volume_oi * 0.5
            status = ModuleStatus.PASS
            reason = f"Volume adequate ({ratio:.2f}x average)"
        elif ratio >= 0.75:
            vol_part = SCORE_WEIGHTS.volume_oi * 0.3
            status = ModuleStatus.PARTIAL
            reason = f"Volume below average ({ratio:.2f}x)"
        else:
            vol_part = 0.0
            status = ModuleStatus.FAIL
            reason = f"Volume weak ({ratio:.2f}x average)"

        oi_part = SCORE_WEIGHTS.volume_oi * 0.3 if oi_data_available else SCORE_WEIGHTS.volume_oi * 0.15
        score = min(SCORE_WEIGHTS.volume_oi, vol_part + oi_part)

        return FilterResult(
            name="volume_oi",
            status=status,
            score=score,
            reason=reason,
            details={"volume_ratio": round(ratio, 3), "oi_data_available": oi_data_available},
        ), score
