# Trade Engine

Production trade execution code currently lives in:

- `backend/src/routes/api.js` at `/api/execute`
- `backend/src/services/binance.js`
- `backend/src/services/userBinance.js`

Trades are opened only through the backend execution path so Binance orders, SL/TP protection, DB writes, and emergency close safeguards stay centralized.
