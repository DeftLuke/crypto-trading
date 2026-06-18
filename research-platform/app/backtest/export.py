"""Export backtest results to JSON, CSV, Parquet."""

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import polars as pl

from app.backtest.types import BacktestResult, TradeRecord
from app.core.config import get_settings


class ExportEngine:
    def __init__(self, root: str | None = None) -> None:
        self.root = Path(root or get_settings().data_root) / "exports" / "backtests"
        self.root.mkdir(parents=True, exist_ok=True)

    def export_all(self, result: BacktestResult, run_id: str) -> dict[str, str]:
        base = self.root / result.backtest_id / run_id
        base.mkdir(parents=True, exist_ok=True)
        paths = {}
        paths["json"] = str(self.export_json(result, base / "summary.json"))
        paths["trades_csv"] = str(self.export_trades_csv(result.trades, base / "trades.csv"))
        paths["trades_parquet"] = str(self.export_trades_parquet(result.trades, base / "trades.parquet"))
        paths["equity_csv"] = str(self.export_equity_csv(result, base / "equity.csv"))
        paths["equity_parquet"] = str(self.export_equity_parquet(result, base / "equity.parquet"))
        if result.monte_carlo:
            paths["monte_carlo"] = str(self.export_json_dict(result.monte_carlo, base / "monte_carlo.json"))
        return paths

    def export_json(self, result: BacktestResult, path: Path) -> Path:
        payload = {
            "backtest_id": result.backtest_id,
            "mode": result.mode,
            "symbols": result.symbols,
            "metrics": result.metrics,
            "analytics": result.analytics,
            "walkforward": result.walkforward,
            "monte_carlo": result.monte_carlo,
            "trade_count": len(result.trades),
            "exported_at": datetime.now(UTC).isoformat(),
        }
        path.write_text(json.dumps(payload, indent=2, default=str))
        return path

    def export_json_dict(self, data: dict, path: Path) -> Path:
        path.write_text(json.dumps(data, indent=2, default=str))
        return path

    def export_trades_csv(self, trades: list[TradeRecord], path: Path) -> Path:
        if not trades:
            path.write_text("trade_id,symbol,direction\n")
            return path
        rows = [t.to_dict() for t in trades]
        pl.DataFrame(rows).write_csv(path)
        return path

    def export_trades_parquet(self, trades: list[TradeRecord], path: Path) -> Path:
        rows = [t.to_dict() for t in trades] if trades else [{"trade_id": ""}]
        pl.DataFrame(rows).write_parquet(path, compression="zstd")
        return path

    def export_equity_csv(self, result: BacktestResult, path: Path) -> Path:
        rows = [{"ts": e.ts, "balance": e.balance, "equity": e.equity, "drawdown_pct": e.drawdown_pct} for e in result.equity_curve]
        pl.DataFrame(rows).write_csv(path) if rows else path.write_text("ts,balance\n")
        return path

    def export_equity_parquet(self, result: BacktestResult, path: Path) -> Path:
        rows = [{"ts": e.ts, "balance": e.balance, "equity": e.equity, "drawdown_pct": e.drawdown_pct} for e in result.equity_curve]
        pl.DataFrame(rows if rows else [{"ts": 0, "balance": 0, "equity": 0}]).write_parquet(path, compression="zstd")
        return path
