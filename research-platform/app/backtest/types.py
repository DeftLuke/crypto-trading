"""Backtest domain types."""

from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4


@dataclass
class TradeRecord:
    trade_id: str
    symbol: str
    direction: str
    entry_time: int
    exit_time: int | None
    entry_price: float
    exit_price: float | None
    leverage: float = 1.0
    margin_pct: float = 0.5
    position_size_usd: float = 0.0
    stop_loss: float | None = None
    take_profit: float | None = None
    fees_usd: float = 0.0
    slippage_usd: float = 0.0
    funding_fees_usd: float = 0.0
    rsi: float | None = None
    ema20: float | None = None
    ema50: float | None = None
    ema100: float | None = None
    ema200: float | None = None
    bos: bool = False
    choch: bool = False
    fvg: bool = False
    order_block: bool = False
    liquidity_sweep: bool = False
    session: str | None = None
    result: str | None = None
    profit_percent: float | None = None
    profit_usd: float | None = None
    mfe: float = 0.0
    mae: float = 0.0
    drawdown: float = 0.0
    strategy_name: str = "smc-mtf"
    signal_confidence: float = 0.0
    exit_reason: str | None = None
    features_json: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "trade_id": self.trade_id,
            "symbol": self.symbol,
            "direction": self.direction,
            "entry_time": self.entry_time,
            "exit_time": self.exit_time,
            "entry_price": self.entry_price,
            "exit_price": self.exit_price,
            "leverage": self.leverage,
            "margin_pct": self.margin_pct,
            "position_size_usd": self.position_size_usd,
            "stop_loss": self.stop_loss,
            "take_profit": self.take_profit,
            "fees_usd": self.fees_usd,
            "slippage_usd": self.slippage_usd,
            "funding_fees_usd": self.funding_fees_usd,
            "rsi": self.rsi,
            "ema20": self.ema20,
            "ema50": self.ema50,
            "ema100": self.ema100,
            "ema200": self.ema200,
            "bos": self.bos,
            "choch": self.choch,
            "fvg": self.fvg,
            "order_block": self.order_block,
            "liquidity_sweep": self.liquidity_sweep,
            "session": self.session,
            "result": self.result,
            "profit_percent": self.profit_percent,
            "profit_usd": self.profit_usd,
            "mfe": self.mfe,
            "mae": self.mae,
            "drawdown": self.drawdown,
            "strategy_name": self.strategy_name,
            "signal_confidence": self.signal_confidence,
            "exit_reason": self.exit_reason,
            "features_json": self.features_json,
        }


@dataclass
class EquityPoint:
    ts: int
    balance: float
    equity: float
    drawdown_pct: float = 0.0
    daily_pnl: float = 0.0


@dataclass
class BacktestSymbolResult:
    symbol: str
    trades: list[TradeRecord]
    equity_curve: list[EquityPoint]
    metrics: dict[str, Any]
    signals_total: int = 0


@dataclass
class BacktestResult:
    backtest_id: str
    mode: str
    symbols: list[str]
    trades: list[TradeRecord]
    equity_curve: list[EquityPoint]
    metrics: dict[str, Any]
    analytics: dict[str, Any] = field(default_factory=dict)
    symbol_results: list[BacktestSymbolResult] = field(default_factory=list)
    walkforward: list[dict[str, Any]] = field(default_factory=list)
    monte_carlo: dict[str, Any] | None = None

    @staticmethod
    def new_id() -> str:
        return str(uuid4())
