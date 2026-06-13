import smcMtf from './smc-mtf/index.js';

const strategies = {
  'smc-mtf': smcMtf,
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
  }));
}

export default strategies;
