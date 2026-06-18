"""AI feedback loop — Phase 5 memory + Phase 6 learning."""

from __future__ import annotations

from typing import Any

from app.core.logging import get_logger
from app.paper_trading.types import PaperTrade

logger = get_logger("paper_trading.feedback")


def on_trade_closed(trade: PaperTrade) -> None:
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
                "session": trade.session,
                "strategy_name": trade.strategy_name,
                "indicators": trade.indicators,
                "smc_features": trade.smc,
                "leverage": trade.leverage,
                "stop_loss": trade.stop_loss,
                "take_profit": trade.take_profit,
            }
        )
        mem.process_trade_close(
            {
                "symbol": trade.symbol,
                "direction": trade.direction,
                "result": trade.result,
                "profit_percent": trade.pnl_pct,
                "strategy_name": trade.strategy_name,
                "session": trade.session,
                "indicators": trade.indicators,
                "smc_features": trade.smc,
            }
        )
        logger.info("Trade sent to memory layer", extra={"trade_id": trade.trade_id})
    except Exception as e:
        logger.warning("Memory feedback failed", extra={"error": str(e)})


async def notify_telegram(message: str) -> None:
    try:
        from app.core.config import get_settings
        import httpx

        s = get_settings()
        if not s.telegram_bot_token or not s.telegram_chat_id:
            return
        url = f"https://api.telegram.org/bot{s.telegram_bot_token}/sendMessage"
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(url, json={"chat_id": s.telegram_chat_id, "text": message, "parse_mode": "HTML"})
    except Exception as e:
        logger.warning("Telegram notify failed", extra={"error": str(e)})
