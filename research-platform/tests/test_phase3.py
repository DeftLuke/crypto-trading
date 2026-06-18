"""Phase 3 backtesting engine tests."""

import polars as pl
import pytest

from app.backtest.analytics import AnalyticsEngine
from app.backtest.comparison import StrategyComparisonEngine
from app.backtest.config import BacktestConfig, BacktestMode, RiskConfig
from app.backtest.metrics import MetricsEngine
from app.backtest.monte_carlo import MonteCarloEngine
from app.backtest.risk_engine import RiskEngine
from app.backtest.simulator import TradeSimulator
from app.backtest.types import EquityPoint, TradeRecord
from app.signals.rules_engine import StrategyRulesEngine


def _sample_rows(n: int = 200) -> list[dict]:
    rows = []
    price = 50000.0
    for i in range(n):
        ts = 1700000000000 + i * 900_000
        price += (i % 7 - 3) * 50
        rows.append({
            "ts": ts,
            "open": price - 20,
            "high": price + 100,
            "low": price - 100,
            "close": price,
            "volume": 1000 + i,
            "rsi14": 85 if i % 20 == 0 else 45,
            "atr14": 500,
            "ema20": price - 100,
            "ema50": price - 200,
            "ema100": price + 500,
            "ema200": price + 800,
            "1h_ema100": price + 300,
            "bos": i % 30 == 0,
            "bos_type": "bearish" if i % 30 == 0 else None,
            "choch": False,
            "order_block": i % 25 == 0,
            "fvg": False,
            "liquidity_sweep": False,
            "session": "london",
        })
    return rows


def test_risk_engine_position_size():
    risk = RiskEngine(RiskConfig(account_balance=100, risk_pct=0.01, margin_pct=0.5, leverage=50))
    size = risk.position_size_usd(50000, 51000, 50)
    assert size > 0
    assert size <= 100 * 0.5 * 50


def test_risk_leverage_fallback():
    risk = RiskEngine(RiskConfig(leverage=50, leverage_fallback=(50, 25, 10)))
    assert risk.resolve_leverage() == 50


def test_metrics_engine_empty():
    m = MetricsEngine().compute([], [], 100)
    assert m["total_trades"] == 0


def test_metrics_engine_with_trades():
    trades = [
        TradeRecord("t1", "BTCUSDT", "SHORT", 1000, 2000, 50000, 49000, profit_usd=10, result="win"),
        TradeRecord("t2", "BTCUSDT", "SHORT", 3000, 4000, 50000, 50500, profit_usd=-5, result="loss"),
    ]
    equity = [EquityPoint(ts=1000, balance=100, equity=100), EquityPoint(ts=4000, balance=105, equity=105)]
    m = MetricsEngine().compute(trades, equity, 100)
    assert m["total_trades"] == 2
    assert m["winning_trades"] == 1
    assert m["net_profit"] == 5


def test_simulator_runs():
    config = BacktestConfig(symbols=["BTCUSDT"], risk=RiskConfig(account_balance=1000))
    rules = StrategyRulesEngine.default_short_rules()
    sim = TradeSimulator(config, rules, "BTCUSDT")
    rows = _sample_rows(100)

    def ctx(row):
        return {
            **row,
            "close_below_ema100_1h": 1,
            "bos_bearish": 1 if row.get("bos_type") == "bearish" else 0,
            "volatility_safe": 1,
        }

    sim.run(rows, ctx)
    assert sim.signals_total >= 0


def test_monte_carlo():
    trades = [
        TradeRecord("t1", "BTC", "LONG", 1, 2, 100, 110, profit_usd=10),
        TradeRecord("t2", "BTC", "LONG", 3, 4, 100, 95, profit_usd=-5),
    ] * 10
    result = MonteCarloEngine().run(trades, 100, simulations=50)
    assert result["simulations"] == 50
    assert "risk_of_ruin" in result


def test_strategy_comparison():
    strategies = [
        {"strategy_name": "a", "return_pct": 20, "max_drawdown_pct": 5, "sharpe_ratio": 1.5, "win_rate": 60, "recovery_factor": 2, "profit_factor": 2},
        {"strategy_name": "b", "return_pct": 10, "max_drawdown_pct": 15, "sharpe_ratio": 0.8, "win_rate": 45, "recovery_factor": 1, "profit_factor": 1.2},
    ]
    ranked = StrategyComparisonEngine().rank(strategies)
    assert ranked[0]["rank"] == 1
    assert ranked[0]["composite_score"] >= ranked[1]["composite_score"]


def test_analytics_session():
    trades = [
        TradeRecord("t1", "BTC", "LONG", 1, 2, 100, 110, profit_usd=10, session="london"),
        TradeRecord("t2", "BTC", "SHORT", 3, 4, 100, 95, profit_usd=-5, session="asian"),
    ]
    stats = AnalyticsEngine().session_stats(trades)
    assert len(stats) == 2


def test_backtest_config_roundtrip():
    cfg = BacktestConfig(mode=BacktestMode.PORTFOLIO, symbols=["BTCUSDT", "ETHUSDT"])
    restored = BacktestConfig.from_dict(cfg.to_dict())
    assert restored.mode == BacktestMode.PORTFOLIO
    assert len(restored.symbols) == 2
