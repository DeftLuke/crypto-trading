"""Persist backtest results to PostgreSQL."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.backtest.types import BacktestResult, EquityPoint, TradeRecord
from app.models.tables import (
    Backtest,
    BacktestDailyStat,
    BacktestDrawdownStat,
    BacktestEquityCurve,
    BacktestMonteCarloResult,
    BacktestRun,
    BacktestSessionStat,
    BacktestSmcStat,
    BacktestSymbolStat,
    BacktestTrade,
    BacktestTradeMetric,
    BacktestWalkforwardResult,
)


class BacktestRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create_backtest(
        self,
        name: str,
        mode: str,
        exchange: str,
        timeframe: str,
        symbols: list[str],
        config_json: dict,
        start_ts: int | None = None,
        end_ts: int | None = None,
    ) -> Backtest:
        bt = Backtest(
            id=uuid4(),
            name=name,
            mode=mode,
            exchange=exchange,
            timeframe=timeframe,
            symbols=symbols,
            config_json=config_json,
            start_ts=start_ts,
            end_ts=end_ts,
            status="pending",
        )
        self.session.add(bt)
        await self.session.flush()
        return bt

    async def update_status(
        self,
        backtest_id: UUID,
        status: str,
        progress_pct: float = 0,
        error: str | None = None,
    ) -> None:
        bt = await self.session.get(Backtest, backtest_id)
        if bt:
            bt.status = status
            bt.progress_pct = progress_pct
            bt.error_message = error
            if status == "running" and not bt.started_at:
                bt.started_at = datetime.now(UTC)
            if status in ("completed", "failed", "stopped"):
                bt.completed_at = datetime.now(UTC)

    async def get_backtest(self, backtest_id: UUID) -> Backtest | None:
        return await self.session.get(Backtest, backtest_id)

    async def persist_result(
        self,
        backtest_id: UUID,
        result: BacktestResult,
        run_id: UUID,
        export_paths: dict[str, str],
    ) -> None:
        run = BacktestRun(
            id=run_id,
            backtest_id=backtest_id,
            run_type=result.mode,
            status="completed",
            metrics_json=result.metrics,
            summary_json={"analytics_keys": list(result.analytics.keys())},
            export_paths=export_paths,
            started_at=datetime.now(UTC),
            completed_at=datetime.now(UTC),
        )
        self.session.add(run)

        self.session.add(BacktestTradeMetric(
            backtest_id=backtest_id,
            run_id=run_id,
            metrics_json=result.metrics,
        ))

        batch: list[BacktestTrade] = []
        for t in result.trades:
            batch.append(BacktestTrade(
                backtest_id=backtest_id,
                run_id=run_id,
                trade_id=t.trade_id,
                symbol=t.symbol,
                direction=t.direction,
                entry_time=t.entry_time,
                exit_time=t.exit_time,
                entry_price=t.entry_price,
                exit_price=t.exit_price,
                leverage=t.leverage,
                margin_pct=t.margin_pct,
                position_size_usd=t.position_size_usd,
                stop_loss=t.stop_loss,
                take_profit=t.take_profit,
                fees_usd=t.fees_usd,
                slippage_usd=t.slippage_usd,
                funding_fees_usd=t.funding_fees_usd,
                rsi=t.rsi,
                ema20=t.ema20,
                ema50=t.ema50,
                ema100=t.ema100,
                ema200=t.ema200,
                bos=t.bos,
                choch=t.choch,
                fvg=t.fvg,
                order_block=t.order_block,
                liquidity_sweep=t.liquidity_sweep,
                session=t.session,
                result=t.result,
                profit_percent=t.profit_percent,
                profit_usd=t.profit_usd,
                mfe=t.mfe,
                mae=t.mae,
                drawdown=t.drawdown,
                strategy_name=t.strategy_name,
                signal_confidence=t.signal_confidence,
                exit_reason=t.exit_reason,
                features_json=t.features_json,
            ))
            if len(batch) >= 500:
                self.session.add_all(batch)
                await self.session.flush()
                batch = []
        if batch:
            self.session.add_all(batch)

        eq_batch = []
        for e in result.equity_curve[::max(1, len(result.equity_curve) // 5000)]:
            eq_batch.append(BacktestEquityCurve(
                backtest_id=backtest_id,
                run_id=run_id,
                ts=e.ts,
                balance=e.balance,
                equity=e.equity,
                drawdown_pct=e.drawdown_pct,
            ))
        if eq_batch:
            self.session.add_all(eq_batch)

        for row in result.analytics.get("sessions", []):
            self.session.add(BacktestSessionStat(
                backtest_id=backtest_id, run_id=run_id,
                session=row["name"], trades=row["trades"], wins=row.get("wins", 0),
                win_rate=row.get("win_rate"), profit_factor=row.get("profit_factor"),
                net_profit=row.get("net_profit", 0),
            ))

        for row in result.analytics.get("symbols", []):
            self.session.add(BacktestSymbolStat(
                backtest_id=backtest_id, run_id=run_id,
                symbol=row["name"], trades=row["trades"], wins=row.get("wins", 0),
                win_rate=row.get("win_rate"), profit_factor=row.get("profit_factor"),
                net_profit=row.get("net_profit", 0),
            ))

        for row in result.analytics.get("smc", []):
            self.session.add(BacktestSmcStat(
                backtest_id=backtest_id, run_id=run_id,
                feature=row["name"], trades=row["trades"], wins=row.get("wins", 0),
                win_rate=row.get("win_rate"), profit_factor=row.get("profit_factor"),
                net_profit=row.get("net_profit", 0),
            ))

        dd = result.analytics.get("drawdown", {})
        self.session.add(BacktestDrawdownStat(
            backtest_id=backtest_id, run_id=run_id,
            max_drawdown_pct=dd.get("max_drawdown_pct"),
            max_drawdown_usd=dd.get("max_drawdown_usd"),
            avg_drawdown_pct=dd.get("avg_drawdown_pct"),
            recovery_factor=dd.get("recovery_factor"),
        ))

        if result.monte_carlo:
            self.session.add(BacktestMonteCarloResult(
                backtest_id=backtest_id, run_id=run_id,
                simulations=result.monte_carlo.get("simulations", 0),
                worst_drawdown_pct=result.monte_carlo.get("worst_drawdown_pct"),
                expected_return_pct=result.monte_carlo.get("expected_return_pct"),
                risk_of_ruin=result.monte_carlo.get("risk_of_ruin"),
                results_json=result.monte_carlo,
            ))

        for fold in result.walkforward:
            self.session.add(BacktestWalkforwardResult(
                backtest_id=backtest_id,
                fold=fold.get("fold", 0),
                train_start_ts=fold.get("train_start_ts"),
                train_end_ts=fold.get("train_end_ts"),
                validate_start_ts=fold.get("validate_start_ts"),
                validate_end_ts=fold.get("validate_end_ts"),
                validate_metrics_json=fold.get("validate_metrics"),
            ))

        await self.update_status(backtest_id, "completed", 100)

    async def get_trades(self, backtest_id: UUID, limit: int = 500) -> list[BacktestTrade]:
        result = await self.session.execute(
            select(BacktestTrade).where(BacktestTrade.backtest_id == backtest_id).limit(limit)
        )
        return list(result.scalars().all())

    async def get_equity(self, backtest_id: UUID, limit: int = 5000) -> list[BacktestEquityCurve]:
        result = await self.session.execute(
            select(BacktestEquityCurve).where(BacktestEquityCurve.backtest_id == backtest_id).limit(limit)
        )
        return list(result.scalars().all())

    async def get_latest_run(self, backtest_id: UUID) -> BacktestRun | None:
        result = await self.session.execute(
            select(BacktestRun).where(BacktestRun.backtest_id == backtest_id).order_by(BacktestRun.created_at.desc()).limit(1)
        )
        return result.scalar_one_or_none()

    async def get_session_stats(self, backtest_id: UUID) -> list[BacktestSessionStat]:
        result = await self.session.execute(
            select(BacktestSessionStat).where(BacktestSessionStat.backtest_id == backtest_id)
        )
        return list(result.scalars().all())

    async def get_smc_stats(self, backtest_id: UUID) -> list[BacktestSmcStat]:
        result = await self.session.execute(
            select(BacktestSmcStat).where(BacktestSmcStat.backtest_id == backtest_id)
        )
        return list(result.scalars().all())

    async def get_monte_carlo(self, backtest_id: UUID) -> BacktestMonteCarloResult | None:
        result = await self.session.execute(
            select(BacktestMonteCarloResult).where(BacktestMonteCarloResult.backtest_id == backtest_id).limit(1)
        )
        return result.scalar_one_or_none()

    async def get_walkforward(self, backtest_id: UUID) -> list[BacktestWalkforwardResult]:
        result = await self.session.execute(
            select(BacktestWalkforwardResult).where(BacktestWalkforwardResult.backtest_id == backtest_id)
        )
        return list(result.scalars().all())
