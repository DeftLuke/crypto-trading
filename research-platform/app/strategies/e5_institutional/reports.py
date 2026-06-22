"""E5 institutional reports — CSV, JSON, HTML (Plotly), charts."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.backtest.types import BacktestResult
from app.core.config import get_settings


def _stamp() -> str:
    return datetime.now(UTC).strftime("%Y%m%d_%H%M%S")


def export_e5_reports(result: BacktestResult, run_id: str) -> dict[str, str]:
    settings = get_settings()
    out_dir = Path(settings.data_root) / "exports" / "e5" / run_id
    out_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, str] = {}

    # JSON summary
    summary_path = out_dir / f"summary_{_stamp()}.json"
    payload = {
        "strategy": "E5_INSTITUTIONAL_V1",
        "backtest_id": result.backtest_id,
        "symbols": result.symbols,
        "metrics": result.metrics,
        "analytics": result.analytics,
        "trade_count": len(result.trades),
    }
    summary_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    paths["json"] = str(summary_path)

    # CSV trades
    csv_path = out_dir / f"trades_{_stamp()}.csv"
    if result.trades:
        import polars as pl
        pl.DataFrame([t.to_dict() for t in result.trades]).write_csv(csv_path)
    else:
        csv_path.write_text("trade_id,symbol,direction,result\n", encoding="utf-8")
    paths["csv"] = str(csv_path)

    # HTML report (Plotly)
    html_path = out_dir / f"report_{_stamp()}.html"
    html_path.write_text(_build_html(result), encoding="utf-8")
    paths["html"] = str(html_path)

    # Equity PNG via matplotlib fallback
    try:
        import matplotlib.pyplot as plt

        if result.equity_curve:
            ts = [e.ts for e in result.equity_curve]
            eq = [e.equity for e in result.equity_curve]
            fig, ax = plt.subplots(figsize=(12, 5))
            ax.plot(ts, eq, color="#10b981")
            ax.set_title("E5 Institutional Equity Curve")
            eq_png = out_dir / "equity.png"
            fig.savefig(eq_png, dpi=120)
            plt.close(fig)
            paths["equity_png"] = str(eq_png)

            peak = eq[0]
            dd = []
            for v in eq:
                peak = max(peak, v)
                dd.append(-(peak - v) / peak * 100 if peak else 0)
            fig, ax = plt.subplots(figsize=(12, 4))
            ax.fill_between(ts, dd, 0, color="#ef4444", alpha=0.5)
            dd_png = out_dir / "drawdown.png"
            fig.savefig(dd_png, dpi=120)
            plt.close(fig)
            paths["drawdown_png"] = str(dd_png)
    except Exception:
        pass

    return paths


def _build_html(result: BacktestResult) -> str:
    m = result.metrics
    rows = "".join(
        f"<tr><td>{t.symbol}</td><td>{t.direction}</td><td>{t.result}</td>"
        f"<td>{t.profit_percent:.2f}%</td><td>{t.signal_confidence:.0f}</td></tr>"
        for t in result.trades[:200]
    )
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>E5 Institutional Report</title>
<style>body{{font-family:system-ui;background:#0a0a0a;color:#e4e4e7;padding:2rem}}
table{{border-collapse:collapse;width:100%}}td,th{{border:1px solid #333;padding:8px}}
.metric{{display:inline-block;margin:1rem;padding:1rem;background:#18181b;border-radius:8px}}
</style></head><body>
<h1>TradeGPT E5 Institutional Backtest</h1>
<div class="metric">Win Rate: {m.get('win_rate', 0):.1f}%</div>
<div class="metric">Net Profit: ${m.get('net_profit', 0):,.2f}</div>
<div class="metric">Profit Factor: {m.get('profit_factor', 0):.2f}</div>
<div class="metric">Sharpe: {m.get('sharpe_ratio', 0):.2f}</div>
<div class="metric">Max DD: {m.get('max_drawdown_pct', 0):.2f}%</div>
<h2>Trades</h2><table><tr><th>Symbol</th><th>Dir</th><th>Result</th><th>PnL%</th><th>Score</th></tr>{rows}</table>
</body></html>"""
