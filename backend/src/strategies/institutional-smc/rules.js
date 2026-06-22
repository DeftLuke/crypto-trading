/** Pattern keys for institutional SMC (1D/4H/1H/15M roles). */

export function buildInstitutionalPatternKey(symbol, direction, explanation = {}) {
  const mtf = explanation?.market_structure?.mtf || {};
  const trend = mtf.trend?.structure_state || mtf.bias?.structure_state || 'na';
  const bias = mtf.bias?.structure_state || 'na';
  const setup = mtf.setup?.structure_state || 'na';
  const sweep = explanation?.liquidity_sweep?.entry?.last_sweep?.sweep_direction
    || explanation?.liquidity_sweep?.setup?.last_sweep?.sweep_direction
    || 'none';
  return `${symbol}:${direction}:${trend}:${bias}:${setup}:${sweep}`;
}
