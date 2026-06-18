# Main Trading Engine Boundary

The main trading engine remains the existing Node.js backend under `backend/src`.

The Telegram Signal Ingestion Service posts normalized external signals to:

```text
POST /api/external-signals/ingest
```

From there, the backend owns every trading decision:

- validation engine: required fields, SMC agreement, confidence score, historical performance
- indicator engine: existing indicator pipeline used by `generateSignal`
- SMC engine: existing SMC/MTF logic
- risk engine: existing `validateTradeExecution`
- trade engine: existing `/api/execute`, Binance order placement, SL/TP protection, emergency close

This folder documents the service boundary and keeps future engine-specific work organized without moving the production backend code yet.
