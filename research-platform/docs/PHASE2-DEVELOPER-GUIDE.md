# Phase 2 Developer Guide

## Adding an Indicator

```python
from app.indicators.base import BaseIndicator
import polars as pl

class MyIndicator(BaseIndicator):
    name = "my_ind"
    output_columns = ["my_ind"]

    def calculate(self, lf: pl.LazyFrame) -> pl.LazyFrame:
        return lf.select(["ts", pl.col("close").rolling_mean(10).alias("my_ind")])
```

Register in `app/indicators/registry.py` → `ALL_INDICATORS`.

## Adding a Strategy Rule (no code deploy)

Insert into `strategy_rules`:

```sql
INSERT INTO strategy_rules (name, direction, conditions_json, priority)
VALUES ('my_long', 'LONG', '[
  {"field": "rsi14", "op": "<", "value": 30, "type": "float"},
  {"field": "bos_bullish", "op": "==", "value": 1, "type": "bool"}
]'::jsonb, 20);
```

Available context fields are built in `AnalysisService.generate_signal()`.

## Running Analysis

```bash
# Indicators
curl "http://localhost:8100/indicators?exchange=binance&symbol=BTCUSDT&timeframe=15m"

# MTF
curl "http://localhost:8100/indicators?exchange=binance&symbol=BTCUSDT&mtf=true"

# Generate signal
curl -X POST "http://localhost:8100/signals/generate?exchange=binance&symbol=BTCUSDT"
```

## Tests

```bash
pytest tests/test_phase2.py -v
```

## Output Schemas

All outputs use plain dicts compatible with JSON, Parquet, and Qdrant indexing. Signal objects follow `TradingSignal.to_dict()` in `app/signals/builder.py`.
