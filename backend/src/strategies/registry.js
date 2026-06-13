import smcMtf from './smc-mtf/index.js';
import freqtrade from './freqtrade/index.js';

const strategies = {
  'smc-mtf': smcMtf,
  freqtrade,
};

export function getStrategy(id) {
  return strategies[id] || null;
}

export function listStrategies() {
  return Object.entries(strategies).map(([id, s]) => ({
    id,
    name: s.name,
    description: s.description,
    timeframes: s.timeframes,
    engine: s.engine || 'native',
    backtestInApp: s.backtestInApp !== false,
    pythonStrategies: s.pythonStrategies || null,
  }));
}

export default strategies;
