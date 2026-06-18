"""AI feedback loop for live trades."""

from __future__ import annotations

from app.core.logging import get_logger
from app.live_trading.types import LiveTrade

logger = get_logger("live_trading.feedback")


def on_live_trade_closed(trade: LiveTrade) -> None:
    try:
        from app.memory.service import get_memory_service

        mem = get_memory_service()
        mem.store_trade(
            {
                "trade_id": trade.trade_id,
                "symbol": trade.symbol,
                "direction": trade.direction,
                "entry": trade.entry_price,
                "exit": trade.exit_price,
                "profit_percent": trade.pnl_pct,
                "profit_usd": trade.pnl_usd,
                "result": trade.result,
                "strategy_name": trade.strategy_name,
                "leverage": trade.leverage,
                "source": "live_trading",
            }
        )
        mem.process_trade_close(
            {
                "symbol": trade.symbol,
                "direction": trade.direction,
                "result": trade.result,
                "profit_percent": trade.pnl_pct,
                "strategy_name": trade.strategy_name,
            }
        )
    except Exception as e:
        logger.warning("Live trade memory feedback failed", extra={"error": str(e)})


async def notify_telegram(message: str) -> None:
    try:
        from app.paper_trading.feedback.memory_loop import notify_telegram as _notify

        await _notify(message)
    except Exception:
        pass
