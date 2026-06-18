"""Bar-by-bar trade simulation with realistic execution."""

from uuid import uuid4

from app.backtest.config import BacktestConfig, ExitConfig
from app.backtest.risk_engine import RiskEngine
from app.backtest.types import EquityPoint, TradeRecord
from app.signals.builder import SignalBuilder
from app.signals.confluence import ConfluenceEngine
from app.signals.rules_engine import StrategyRule, StrategyRulesEngine
from app.signals.volatility import VolatilityFilter


class Position:
    __slots__ = (
        "trade", "sl", "tp1", "tp2", "tp3_trail", "trail_active",
        "trail_stop", "bars_held", "partial_closed", "entry_bar_idx",
    )

    def __init__(self, trade: TradeRecord, sl: float, tp1: float, tp2: float | None) -> None:
        self.trade = trade
        self.sl = sl
        self.tp1 = tp1
        self.tp2 = tp2
        self.tp3_trail = False
        self.trail_active = False
        self.trail_stop: float | None = None
        self.bars_held = 0
        self.partial_closed = False
        self.entry_bar_idx = 0


class TradeSimulator:
    """Simulate trade lifecycle on precomputed feature rows."""

    def __init__(
        self,
        config: BacktestConfig,
        rules: list[StrategyRule],
        symbol: str,
    ) -> None:
        self.config = config
        self.rules_engine = StrategyRulesEngine()
        self.rules = rules
        self.symbol = symbol
        self.risk = RiskEngine(config.risk)
        self.signal_builder = SignalBuilder(
            atr_sl_mult=config.exit.atr_sl_mult,
            atr_tp_mult=config.exit.atr_tp_mult,
        )
        self.confluence = ConfluenceEngine()
        self.volatility = VolatilityFilter(threshold_pct=30.0)
        self.trades: list[TradeRecord] = []
        self.equity_curve: list[EquityPoint] = []
        self.positions: list[Position] = []
        self.signals_total = 0

    def _apply_slippage(self, price: float, direction: str, is_entry: bool) -> float:
        slip = price * self.config.slippage_pct
        if direction == "LONG":
            return price + slip if is_entry else price - slip
        return price - slip if is_entry else price + slip

    def _fees(self, notional: float) -> float:
        return notional * self.config.fee_rate * 2

    def _funding(self, notional: float, bars: int) -> float:
        intervals = bars // 32
        return notional * self.config.funding_rate * intervals

    def _open_trade(self, row: dict, direction: str, confidence: float, bar_idx: int) -> Position | None:
        if not self.risk.can_open_position():
            return None
        price = float(row["close"])
        atr = float(row.get("atr14") or price * 0.01)
        signal = self.signal_builder.build(
            symbol=self.symbol,
            direction=direction,
            confidence=confidence,
            price=price,
            atr=atr,
            exchange=self.config.exchange,
            timeframe=self.config.timeframe,
        )
        lev = self.risk.resolve_leverage()
        entry = self._apply_slippage(price, direction, True)
        sl = signal.stop_loss or price
        size = self.risk.position_size_usd(entry, sl, lev)
        if size <= 0:
            return None

        trade = TradeRecord(
            trade_id=str(uuid4())[:12],
            symbol=self.symbol,
            direction=direction,
            entry_time=int(row["ts"]),
            exit_time=None,
            entry_price=entry,
            exit_price=None,
            leverage=lev,
            margin_pct=self.config.risk.margin_pct,
            position_size_usd=size,
            stop_loss=sl,
            take_profit=signal.tp1,
            rsi=row.get("rsi14"),
            ema20=row.get("ema20"),
            ema50=row.get("ema50"),
            ema100=row.get("ema100"),
            ema200=row.get("ema200"),
            bos=bool(row.get("bos")),
            choch=bool(row.get("choch")),
            fvg=bool(row.get("fvg")),
            order_block=bool(row.get("order_block")),
            liquidity_sweep=bool(row.get("liquidity_sweep")),
            session=row.get("session"),
            strategy_name=self.config.strategy_name,
            signal_confidence=confidence,
        )
        self.risk.register_open()
        pos = Position(trade, sl=sl, tp1=signal.tp1 or price, tp2=signal.tp2)
        pos.entry_bar_idx = bar_idx
        return pos

    def _close_position(self, pos: Position, exit_price: float, ts: int, reason: str) -> None:
        t = pos.trade
        direction = t.direction
        exit_px = self._apply_slippage(exit_price, direction, False)
        t.exit_time = ts
        t.exit_price = exit_px
        t.exit_reason = reason

        if direction == "LONG":
            raw_pnl_pct = (exit_px - t.entry_price) / t.entry_price
        else:
            raw_pnl_pct = (t.entry_price - exit_px) / t.entry_price

        leveraged_pnl_pct = raw_pnl_pct * t.leverage
        t.profit_percent = leveraged_pnl_pct * 100
        gross = t.position_size_usd * raw_pnl_pct * t.leverage
        t.fees_usd = self._fees(t.position_size_usd)
        t.slippage_usd = abs(exit_px - exit_price) / exit_price * t.position_size_usd if exit_price else 0
        t.funding_fees_usd = self._funding(t.position_size_usd, pos.bars_held)
        t.profit_usd = gross - t.fees_usd - t.funding_fees_usd

        if t.profit_usd > 0.01:
            t.result = "win"
        elif t.profit_usd < -0.01:
            t.result = "loss"
        else:
            t.result = "breakeven"

        self.risk.register_close(t.profit_usd or 0)
        self.trades.append(t)

    def _update_mfe_mae(self, pos: Position, high: float, low: float) -> None:
        t = pos.trade
        if t.direction == "LONG":
            fav = (high - t.entry_price) / t.entry_price * t.leverage * t.position_size_usd
            adv = (t.entry_price - low) / t.entry_price * t.leverage * t.position_size_usd
        else:
            fav = (t.entry_price - low) / t.entry_price * t.leverage * t.position_size_usd
            adv = (high - t.entry_price) / t.entry_price * t.leverage * t.position_size_usd
        t.mfe = max(t.mfe, fav)
        t.mae = max(t.mae, adv)

    def _check_exits(self, pos: Position, row: dict, bar_idx: int) -> bool:
        high, low, close = float(row["high"]), float(row["low"]), float(row["close"])
        ts = int(row["ts"])
        t = pos.trade
        exit_cfg: ExitConfig = self.config.exit
        pos.bars_held = bar_idx - pos.entry_bar_idx

        if exit_cfg.max_bars and pos.bars_held >= exit_cfg.max_bars:
            self._close_position(pos, close, ts, "time_exit")
            return True

        liq = self.risk.liquidation_price(t.entry_price, t.direction, int(t.leverage))
        if t.direction == "LONG" and low <= liq:
            self._close_position(pos, liq, ts, "liquidation")
            return True
        if t.direction == "SHORT" and high >= liq:
            self._close_position(pos, liq, ts, "liquidation")
            return True

        if t.direction == "LONG":
            if low <= pos.sl:
                self._close_position(pos, pos.sl, ts, "stop_loss")
                return True
            if high >= pos.tp1 and not pos.partial_closed and exit_cfg.partial_tp_pct > 0:
                partial_pnl = t.position_size_usd * exit_cfg.partial_tp_pct * (
                    (pos.tp1 - t.entry_price) / t.entry_price * t.leverage
                )
                t.position_size_usd *= (1 - exit_cfg.partial_tp_pct)
                self.risk.balance += partial_pnl
                pos.partial_closed = True
                pos.sl = t.entry_price
            elif high >= pos.tp1:
                self._close_position(pos, pos.tp1, ts, "take_profit")
                return True
            if pos.tp2 and high >= pos.tp2:
                self._close_position(pos, pos.tp2, ts, "take_profit_2")
                return True
            if exit_cfg.use_trailing and high >= t.entry_price * (1 + exit_cfg.breakeven_after_rr * 0.01):
                pos.trail_active = True
                pos.trail_stop = max(pos.trail_stop or pos.sl, close * (1 - exit_cfg.trailing_pct))
                if low <= (pos.trail_stop or 0):
                    self._close_position(pos, pos.trail_stop or close, ts, "trailing_stop")
                    return True
        else:
            if high >= pos.sl:
                self._close_position(pos, pos.sl, ts, "stop_loss")
                return True
            if low <= pos.tp1 and not pos.partial_closed and exit_cfg.partial_tp_pct > 0:
                partial_pnl = t.position_size_usd * exit_cfg.partial_tp_pct * (
                    (t.entry_price - pos.tp1) / t.entry_price * t.leverage
                )
                t.position_size_usd *= (1 - exit_cfg.partial_tp_pct)
                self.risk.balance += partial_pnl
                pos.partial_closed = True
                pos.sl = t.entry_price
            elif low <= pos.tp1:
                self._close_position(pos, pos.tp1, ts, "take_profit")
                return True
            if pos.tp2 and low <= pos.tp2:
                self._close_position(pos, pos.tp2, ts, "take_profit_2")
                return True
            if exit_cfg.use_trailing and low <= t.entry_price * (1 - exit_cfg.breakeven_after_rr * 0.01):
                pos.trail_active = True
                pos.trail_stop = min(pos.trail_stop or pos.sl, close * (1 + exit_cfg.trailing_pct))
                if high >= (pos.trail_stop or float("inf")):
                    self._close_position(pos, pos.trail_stop or close, ts, "trailing_stop")
                    return True

        if exit_cfg.sl_mode.value == "structure" and row.get("choch"):
            self._close_position(pos, close, ts, "structure_exit")
            return True

        return False

    def run(self, rows: list[dict], ctx_builder) -> None:
        open_positions: list[Position] = []
        peak = self.risk.balance

        for i, row in enumerate(rows):
            ts = int(row["ts"])
            self.risk.reset_day(ts)
            ctx = ctx_builder(row)

            still_open: list[Position] = []
            for pos in open_positions:
                self._update_mfe_mae(pos, float(row["high"]), float(row["low"]))
                if not self._check_exits(pos, row, i):
                    still_open.append(pos)
            open_positions = still_open

            matched = self.rules_engine.match(self.rules, ctx)
            if matched and self.risk.can_open_position():
                smc = {k: ctx.get(k) for k in ("bos", "bos_type", "choch", "order_block", "fvg", "liquidity_sweep") if k in ctx}
                indicators = {k: ctx.get(k) for k in ctx if k.startswith(("ema", "rsi", "atr", "macd", "1h_"))}
                conf = self.confluence.score(indicators, smc, matched.direction)
                if conf.score >= self.config.min_confidence and ctx.get("volatility_safe"):
                    self.signals_total += 1
                    if not self.config.risk.allow_pyramiding and open_positions:
                        pass
                    else:
                        pos = self._open_trade(row, matched.direction, conf.score, i)
                        if pos:
                            open_positions.append(pos)

            bal = self.risk.balance
            peak = max(peak, bal)
            dd = (peak - bal) / peak * 100 if peak else 0
            self.equity_curve.append(EquityPoint(ts=ts, balance=bal, equity=bal, drawdown_pct=dd))

        for pos in open_positions:
            last = rows[-1]
            self._close_position(pos, float(last["close"]), int(last["ts"]), "end_of_data")
