"""Monte Carlo stress testing on trade sequences."""

import random
from typing import Any

import numpy as np

from app.backtest.types import TradeRecord


class MonteCarloEngine:
    def run(
        self,
        trades: list[TradeRecord],
        initial_balance: float,
        simulations: int = 1000,
    ) -> dict[str, Any]:
        pnls = [t.profit_usd or 0 for t in trades if t.profit_usd is not None]
        if not pnls:
            return {"simulations": 0, "error": "no_trades"}

        sims = min(simulations, 5000)
        final_returns: list[float] = []
        max_drawdowns: list[float] = []
        ruin_count = 0

        for _ in range(sims):
            shuffled = random.sample(pnls, len(pnls)) if len(pnls) > 1 else pnls[:]
            balance = initial_balance
            peak = balance
            max_dd = 0
            ruined = False
            for p in shuffled:
                balance += p
                if balance <= initial_balance * 0.1:
                    ruined = True
                peak = max(peak, balance)
                dd = (peak - balance) / peak * 100 if peak else 0
                max_dd = max(max_dd, dd)
            final_returns.append((balance - initial_balance) / initial_balance * 100)
            max_drawdowns.append(max_dd)
            if ruined:
                ruin_count += 1

        arr = np.array(final_returns)
        dd_arr = np.array(max_drawdowns)
        return {
            "simulations": sims,
            "expected_return_pct": round(float(arr.mean()), 4),
            "median_return_pct": round(float(np.median(arr)), 4),
            "worst_return_pct": round(float(arr.min()), 4),
            "best_return_pct": round(float(arr.max()), 4),
            "worst_drawdown_pct": round(float(dd_arr.max()), 4),
            "avg_drawdown_pct": round(float(dd_arr.mean()), 4),
            "risk_of_ruin": round(ruin_count / sims * 100, 4),
            "return_std": round(float(arr.std()), 4),
            "percentile_5": round(float(np.percentile(arr, 5)), 4),
            "percentile_95": round(float(np.percentile(arr, 95)), 4),
        }
