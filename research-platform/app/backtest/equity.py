"""Equity curve and periodic PnL aggregation."""

from datetime import UTC, datetime
from typing import Any

from app.backtest.types import EquityPoint, TradeRecord


class EquityEngine:
    def daily_pnl(self, equity: list[EquityPoint]) -> list[dict[str, Any]]:
        if not equity:
            return []
        by_day: dict[str, dict] = {}
        prev = equity[0].balance
        for e in equity:
            day = datetime.fromtimestamp(e.ts / 1000, tz=UTC).date().isoformat()
            if day not in by_day:
                by_day[day] = {"date": day, "balance": e.balance, "pnl_usd": 0, "drawdown_pct": e.drawdown_pct}
            by_day[day]["balance"] = e.balance
            by_day[day]["drawdown_pct"] = e.drawdown_pct
        days = sorted(by_day.keys())
        out = []
        prev_bal = equity[0].balance
        for d in days:
            row = by_day[d]
            row["pnl_usd"] = row["balance"] - prev_bal
            row["pnl_pct"] = row["pnl_usd"] / prev_bal * 100 if prev_bal else 0
            prev_bal = row["balance"]
            out.append(row)
        return out

    def aggregate_trades_by_period(
        self,
        trades: list[TradeRecord],
        period: str,
    ) -> list[dict[str, Any]]:
        closed = [t for t in trades if t.exit_time and t.profit_usd is not None]
        buckets: dict[str, dict] = {}

        for t in closed:
            dt = datetime.fromtimestamp(t.exit_time / 1000, tz=UTC)
            if period == "weekly":
                key = f"{dt.isocalendar().year}-W{dt.isocalendar().week:02d}"
            elif period == "monthly":
                key = f"{dt.year}-{dt.month:02d}"
            elif period == "yearly":
                key = str(dt.year)
            else:
                key = dt.date().isoformat()

            if key not in buckets:
                buckets[key] = {"period": key, "trades": 0, "wins": 0, "pnl_usd": 0}
            buckets[key]["trades"] += 1
            buckets[key]["pnl_usd"] += t.profit_usd or 0
            if (t.profit_usd or 0) > 0:
                buckets[key]["wins"] += 1

        return sorted(buckets.values(), key=lambda x: x["period"])
