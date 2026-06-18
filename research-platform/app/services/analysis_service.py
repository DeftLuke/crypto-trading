"""Phase 2 analysis orchestration service."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.indicators.engine import compute_all_indicators, serialize_indicators
from app.indicators.mtf import MultiTimeframeEngine
from app.models.tables import (
    ConfluenceScore,
    FairValueGap,
    LiquidityLevel,
    LiquiditySweep,
    MarketSession,
    MarketStructure,
    OrderBlock,
    SignalCandidate,
    StrategyRuleRow,
)
from app.signals.builder import SignalBuilder
from app.signals.confluence import ConfluenceEngine
from app.signals.rules_engine import StrategyRule, StrategyRulesEngine
from app.signals.sessions import SessionEngine
from app.signals.telegram_formatter import TelegramSignalFormatter
from app.signals.volatility import VolatilityFilter
from app.smc.engine import SmcEngine
from app.storage.parquet_store import ParquetStorage


class AnalysisService:
    """Single source of truth for indicators + SMC + signals."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.store = ParquetStorage()
        self.smc = SmcEngine()
        self.mtf = MultiTimeframeEngine(self.store)
        self.confluence = ConfluenceEngine()
        self.volatility = VolatilityFilter(threshold_pct=30.0)
        self.sessions = SessionEngine()
        self.signals = SignalBuilder()
        self.rules = StrategyRulesEngine()
        self.telegram = TelegramSignalFormatter()

    def _load_df(self, exchange: str, symbol: str, timeframe: str):
        lf = self.store.read_candles_lazy(exchange, symbol, timeframe)
        if lf is None:
            return None
        return lf.collect().sort("ts")

    def compute_indicators(self, exchange: str, symbol: str, timeframe: str) -> dict:
        lf = self.store.read_candles_lazy(exchange, symbol, timeframe)
        if lf is None:
            return {"rows": 0, "latest": {}}
        df = compute_all_indicators(lf)
        latest = df.tail(1).to_dicts()[0] if len(df) else {}
        return {"rows": len(df), "latest": serialize_indicators(latest), "sample": df.tail(10).to_dicts()}

    def compute_mtf(self, exchange: str, symbol: str, base_tf: str = "15m") -> dict:
        snap = self.mtf.latest_snapshot(exchange, symbol, base_tf, ("1h", "4h"))
        return snap

    def compute_smc(self, exchange: str, symbol: str, timeframe: str) -> dict:
        df = self._load_df(exchange, symbol, timeframe)
        if df is None:
            return {"bars": 0, "latest": {}, "zones": []}
        result = self.smc.analyze(df)
        latest = result.latest()
        return {
            "bars": len(result.bars),
            "latest": latest.to_dict() if latest else {},
            "zones": [z.to_dict() for z in result.zones[-20:]],
        }

    async def persist_smc(self, exchange: str, symbol: str, timeframe: str) -> int:
        df = self._load_df(exchange, symbol, timeframe)
        if df is None:
            return 0
        result = self.smc.analyze(df)
        count = 0
        for bar in result.bars[-500:]:
            if bar.bos or bar.choch:
                self.session.add(MarketStructure(
                    exchange=exchange, symbol=symbol, timeframe=timeframe, ts=bar.ts,
                    bos=bar.bos, bos_type=bar.bos_type, choch=bar.choch,
                    choch_type=bar.choch_type, structure_bias=bar.structure_bias,
                    external_structure=bar.external_structure,
                    internal_structure=bar.internal_structure,
                    idm=bar.idm, details_json=bar.to_dict(),
                ))
                count += 1
            if bar.order_block and bar.ob_high and bar.ob_low:
                self.session.add(OrderBlock(
                    exchange=exchange, symbol=symbol, timeframe=timeframe, ts=bar.ts,
                    direction=bar.ob_direction or "neutral",
                    high=bar.ob_high, low=bar.ob_low,
                ))
                count += 1
            if bar.fvg and bar.fvg_top and bar.fvg_bottom:
                self.session.add(FairValueGap(
                    exchange=exchange, symbol=symbol, timeframe=timeframe, ts=bar.ts,
                    direction=bar.fvg_direction or "neutral",
                    top=bar.fvg_top, bottom=bar.fvg_bottom,
                ))
                count += 1
            if bar.liquidity_type:
                self.session.add(LiquidityLevel(
                    exchange=exchange, symbol=symbol, timeframe=timeframe, ts=bar.ts,
                    liquidity_type=bar.liquidity_type, price=bar.fvg_top or 0,
                ))
                count += 1
            if bar.liquidity_sweep:
                self.session.add(LiquiditySweep(
                    exchange=exchange, symbol=symbol, timeframe=timeframe, ts=bar.ts,
                    sweep_direction=bar.sweep_direction or "unknown",
                ))
                count += 1
        await self.session.flush()
        return count

    async def load_rules(self) -> list[StrategyRule]:
        result = await self.session.execute(
            select(StrategyRuleRow).where(StrategyRuleRow.enabled.is_(True))
        )
        rows = list(result.scalars().all())
        if not rows:
            return StrategyRulesEngine.default_short_rules()
        return [StrategyRule.from_row(r) for r in rows]

    async def generate_signal(
        self,
        exchange: str,
        symbol: str,
        timeframe: str = "15m",
    ) -> dict:
        df = self._load_df(exchange, symbol, timeframe)
        if df is None or df.is_empty():
            return {"error": "no_data"}

        ind_df = compute_all_indicators(self.store.read_candles_lazy(exchange, symbol, timeframe))
        latest_ind = ind_df.tail(1).to_dicts()[0]
        indicators = serialize_indicators(latest_ind)
        mtf = self.mtf.latest_snapshot(exchange, symbol, timeframe, ("1h",))
        indicators.update(mtf)
        indicators["close"] = latest_ind.get("close")
        indicators["15m_close"] = latest_ind.get("close")

        smc_result = self.smc.analyze(df)
        smc = smc_result.latest().to_dict() if smc_result.latest() else {}

        vol = self.volatility.evaluate(df)
        session = self.sessions.detect(int(df["ts"][-1]))

        ema100_1h = mtf.get("1h_ema100")
        close = latest_ind.get("close")
        ctx = {
            **indicators,
            **smc,
            "rsi14": indicators.get("rsi14"),
            "close_below_ema100_1h": 1 if (close and ema100_1h and close < ema100_1h) else 0,
            "bos_bearish": 1 if smc.get("bos_type") == "bearish" else 0,
            "bos_bullish": 1 if smc.get("bos_type") == "bullish" else 0,
            "volatility_safe": 1 if vol.safe else 0,
        }

        rules = await self.load_rules()
        matched = self.rules.match(rules, ctx)
        direction = matched.direction if matched else "SHORT"
        conf = self.confluence.score(indicators, smc, direction)

        if not vol.safe:
            return {"skipped": True, "reason": "volatility", "volatility": vol.to_dict()}

        signal = self.signals.build(
            symbol=symbol,
            direction=direction,
            confidence=conf.score,
            price=float(close),
            atr=indicators.get("atr14"),
            exchange=exchange,
            timeframe=timeframe,
            confluence=conf.to_dict(),
            smc=smc,
            indicators=indicators,
            metadata={"volatility": vol.to_dict(), "session": session},
        )
        sig_dict = signal.to_dict()
        sig_dict["telegram"] = self.telegram.format({**sig_dict, "metadata": signal.metadata})

        if matched:
            candidate = SignalCandidate(
                exchange=exchange, symbol=symbol, timeframe=timeframe,
                direction=signal.direction, confidence=signal.confidence,
                entry=signal.entry, stop_loss=signal.stop_loss,
                tp1=signal.tp1, tp2=signal.tp2, tp3=str(signal.tp3),
                rule_name=matched.name, signal_json=sig_dict,
                telegram_text=sig_dict["telegram"],
            )
            self.session.add(candidate)
            self.session.add(ConfluenceScore(
                exchange=exchange, symbol=symbol, timeframe=timeframe,
                ts=int(df["ts"][-1]), direction=direction,
                score=conf.score, breakdown_json=conf.breakdown,
            ))
            self.session.add(MarketSession(
                exchange=exchange, symbol=symbol,
                ts=int(df["ts"][-1]), session=session["session"],
                hour_utc=session["hour_utc"],
            ))
            await self.session.flush()

        return sig_dict
