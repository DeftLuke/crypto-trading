"""Strategy validation — approve/reject for Phase 8 promotion."""

from __future__ import annotations

from app.core.config import get_settings
from app.paper_trading.performance.analytics import PerformanceAnalytics
from app.paper_trading.types import PaperTrade, StrategyValidation, utc_now


class ValidationEngine:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.analytics = PerformanceAnalytics()

    def evaluate(self, strategy_name: str, trades: list[PaperTrade]) -> StrategyValidation:
        metrics = self.analytics.compute(trades)
        notes: list[str] = []
        score = 0.0
        count = metrics["total_trades"]
        wr = metrics["win_rate"]
        pf = metrics["profit_factor"]
        sharpe = metrics["sharpe_ratio"]
        sortino = metrics["sortino_ratio"]
        dd = metrics["max_drawdown_pct"]

        min_trades = self.settings.paper_validation_min_trades
        if count >= min_trades:
            score += 25
        else:
            notes.append(f"Need {min_trades} trades, have {count}")

        if pf >= self.settings.paper_validation_min_pf:
            score += 25
        else:
            notes.append(f"Profit factor {pf:.2f} < {self.settings.paper_validation_min_pf}")

        if sharpe >= self.settings.paper_validation_min_sharpe:
            score += 20
        else:
            notes.append(f"Sharpe {sharpe:.2f} < {self.settings.paper_validation_min_sharpe}")

        if dd <= self.settings.paper_validation_max_dd:
            score += 20
        else:
            notes.append(f"Drawdown {dd:.1f}% > {self.settings.paper_validation_max_dd}%")

        if wr >= self.settings.paper_validation_min_win_rate:
            score += 10
        else:
            notes.append(f"Win rate {wr:.1f}% below minimum")

        if count >= min_trades and pf >= self.settings.paper_validation_min_pf and sharpe >= self.settings.paper_validation_min_sharpe and dd <= self.settings.paper_validation_max_dd:
            verdict = "pass"
        elif score >= 50:
            verdict = "warning"
        else:
            verdict = "reject"

        return StrategyValidation(
            strategy_name=strategy_name,
            verdict=verdict,
            approval_score=round(score, 1),
            trade_count=count,
            win_rate=wr,
            profit_factor=pf,
            sharpe=sharpe,
            sortino=sortino,
            max_drawdown_pct=dd,
            notes=notes,
            evaluated_at=utc_now(),
        )
