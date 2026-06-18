"""Trade recall engine — find similar historical setups."""

from __future__ import annotations

from typing import Any

from app.memory.retrieval.engine import RetrievalEngine
from app.memory.types import build_search_text


class TradeRecallEngine:
    def __init__(self, retrieval: RetrievalEngine):
        self.retrieval = retrieval

    def build_setup_query(self, setup: dict[str, Any]) -> str:
        return build_search_text(setup)

    def recall_similar_trades(
        self,
        setup: dict[str, Any],
        limit: int = 20,
    ) -> dict[str, Any]:
        query = self.build_setup_query(setup)
        filters: dict[str, Any] = {}
        if setup.get("symbol"):
            filters["symbol"] = setup["symbol"]
        if setup.get("direction"):
            filters["direction"] = setup["direction"]

        results = self.retrieval.semantic_search(
            "trade_memories",
            query,
            limit=limit,
            filters=filters or None,
        )

        if not results:
            results = self.retrieval.semantic_search("trade_memories", query, limit=limit)

        wins = [r for r in results if (r.get("result") or "").upper() == "WIN"]
        losses = [r for r in results if (r.get("result") or "").upper() == "LOSS"]
        profits = [float(r["profit_percent"]) for r in results if r.get("profit_percent") is not None]

        win_rate = (len(wins) / len(results) * 100) if results else 0.0
        avg_profit = sum(profits) / len(profits) if profits else 0.0
        confidence = min(0.95, 0.4 + len(results) * 0.02 + win_rate / 200)

        return {
            "query": query,
            "setup": setup,
            "count": len(results),
            "win_rate": round(win_rate, 2),
            "average_profit_percent": round(avg_profit, 3),
            "confidence": round(confidence, 3),
            "wins": len(wins),
            "losses": len(losses),
            "examples": results[:10],
        }
