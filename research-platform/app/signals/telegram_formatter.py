"""Telegram signal message formatter."""

from typing import Any


class TelegramSignalFormatter:
    def format(self, signal: dict[str, Any]) -> str:
        symbol = signal.get("symbol", "UNKNOWN")
        direction = signal.get("direction", "NEUTRAL")
        confidence = signal.get("confidence", 0)
        is_short = direction.upper() == "SHORT"
        emoji = "🔴" if is_short else "🟢"
        dir_label = "SHORT" if is_short else "LONG"

        lines = [
            f"🎯 SIGNAL — {symbol}",
            "",
            f"Direction: {emoji} {dir_label}",
            f"Confidence: {confidence:.0f}/100",
            "",
            "📊 Breakdown:",
        ]

        smc = signal.get("smc", {})
        indicators = signal.get("indicators", {})
        confluence = signal.get("confluence", {})
        vol = signal.get("metadata", {}).get("volatility", {})

        if indicators.get("ema100") or indicators.get("1h_ema100"):
            ema = indicators.get("1h_ema100") or indicators.get("ema100")
            cmp_ = "<" if is_short else ">"
            lines.append(f"✅ EMA: Price {cmp_} EMA100 on 1H ({ema:.0f})" if ema else "✅ EMA: aligned")

        rsi = indicators.get("rsi14") or indicators.get("rsi") or indicators.get("15m_rsi14")
        if rsi:
            lines.append(f"✅ RSI: RSI {rsi:.0f} {'> 80' if is_short else '< 30'}")

        if smc.get("bos") or smc.get("bos_type"):
            lines.append(f"✅ SMC: {'Bearish' if is_short else 'Bullish'} BOS aligned")

        if smc.get("order_block"):
            lines.append(f"✅ ORDERBLOCK: {'Bearish' if is_short else 'Bullish'} OB retest")

        if smc.get("liquidity_sweep"):
            side = "Sell-side" if is_short else "Buy-side"
            lines.append(f"✅ LIQUIDITY: {side} sweep detected")

        if vol.get("volatility") is not None:
            lines.append(f"✅ VOLATILITY: {vol['volatility']:.0f}%")

        for k, v in confluence.get("breakdown", {}).items():
            if v and v > 0:
                lines.append(f"  • {k.replace('_', ' ').title()}: +{v:.0f}")

        lines.extend([
            "",
            f"💰 Entry: {signal.get('entry', '—')}",
            f"🛑 SL: {signal.get('stop_loss', '—')}",
            f"🎯 TP1: {signal.get('tp1', '—')}",
            f"🎯 TP2: {signal.get('tp2', '—')}",
            f"🎯 TP3: {signal.get('tp3', 'Trailing')}",
        ])
        return "\n".join(lines)
