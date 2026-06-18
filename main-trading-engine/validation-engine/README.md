# Validation Engine

Production code currently lives in:

- `backend/src/services/externalSignalIngestion.js`
- `backend/src/strategy/riskManager.js`

External Telegram signals are accepted only after shape validation, SMC direction agreement, validation scoring, and existing risk checks.
