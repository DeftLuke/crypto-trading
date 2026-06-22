#!/usr/bin/env python3
"""CLI — download Binance Vision archives to local Parquet store."""

from __future__ import annotations

import argparse
import sys

from app.market_data.constants import INSTITUTIONAL_MTF
from app.market_data.manager import MarketDataManager


def main() -> int:
    parser = argparse.ArgumentParser(description="Download Binance Vision kline archives")
    parser.add_argument("symbol", help="e.g. BTCUSDT")
    parser.add_argument(
        "--timeframes",
        default=",".join(INSTITUTIONAL_MTF),
        help="Comma-separated intervals",
    )
    parser.add_argument("--months-back", type=int, default=None)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    mgr = MarketDataManager(workers=args.workers)
    tfs = [t.strip() for t in args.timeframes.split(",") if t.strip()]

    for tf in tfs:
        print(f"\n=== {args.symbol.upper()} {tf} ===")
        result = mgr.ingest_archives(
            args.symbol.upper(),
            tf,
            months_back=args.months_back,
            force=args.force,
        )
        dl = result["download"]
        print(f"Download: {dl['completed']} ok, {dl['skipped']} skipped, {dl['failed']} failed ({dl['pct']}%)")
        print(f"Converted: {result['converted']} parquet files")
        print(f"Status: {result['status']}")

    print("\nStorage:", mgr.storage_stats())
    return 0


if __name__ == "__main__":
    sys.exit(main())
