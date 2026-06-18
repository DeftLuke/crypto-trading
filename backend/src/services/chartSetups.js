import { getStrategy } from '../strategies/registry.js';
import { formatTradeForApi } from '../strategies/backtestEngine.js';

/** Historical + live trade setups for chart drawing */
export async function getChartSetups(symbol, strategyId = 'smc-mtf', {
  interval = '5m',
  period = '1m',
  maxTrades = 25,
} = {}) {
  const strategy = getStrategy(strategyId);
  if (!strategy) throw new Error(`Strategy ${strategyId} not found`);

  let historical = [];
  let stats = null;

  if (strategy.runBacktest) {
    const bt = await strategy.runBacktest({
      symbol: symbol.toUpperCase(),
      entryInterval: interval,
      period,
      initialCapital: 1000,
    });
    historical = (bt.trades || []).slice(-maxTrades).map(formatTradeForApi);
    stats = bt.stats || null;
  }

  let current = null;
  if (strategy.generateSignal) {
    try {
      const sig = await strategy.generateSignal(symbol.toUpperCase());
      if (sig && sig.direction !== 'IGNORE' && sig.entry_price) {
        current = {
          direction: sig.direction,
          entry: sig.entry_price,
          stopLoss: sig.stop_loss,
          tp1: sig.tp1,
          tp2: sig.tp2,
          tp3: sig.tp3,
          entryTime: Math.floor(Date.now() / 1000),
          open: true,
          confidence: sig.confidence,
        };
      }
    } catch {
      /* no live setup */
    }
  }

  return {
    symbol: symbol.toUpperCase(),
    strategyId,
    interval,
    period,
    historical,
    current,
    stats,
  };
}
