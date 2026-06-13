/**
 * Freqtrade strategy adapter — Python bot controlled via REST API.
 * Backtests run through Freqtrade CLI; live/dry-run from dashboard.
 */
export const id = 'freqtrade';
export const name = 'Freqtrade (RSI / EMA)';
export const description =
  'Popular Python bot: RSI momentum + EMA crossover. Dry-run, backtest, and live trading via Freqtrade engine.';
export const engine = 'freqtrade';
export const backtestInApp = false;
export const timeframes = ['5m', '15m', '30m', '1h'];
export const pythonStrategies = [
  'TradeGPT_RSI_Momentum',
  'TradeGPT_EMA_Crossover',
];

export default {
  id,
  name,
  description,
  engine,
  backtestInApp,
  timeframes,
  pythonStrategies,
};
