const KEY = 'tradegpt-tv-config';

const DEFAULTS = {
  chartMode: 'tv-widget',
  pineStudyId: '',
  chartLayoutUrl: '',
  tvUsername: '',
};

export function loadTvConfig() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveTvConfig(partial) {
  const next = { ...loadTvConfig(), ...partial };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function buildAccountChartUrl(tvSymbol, interval, config) {
  if (config.chartLayoutUrl?.trim()) {
    const url = config.chartLayoutUrl.trim();
    if (url.includes('tradingview.com/chart')) return url;
  }
  const sym = encodeURIComponent(tvSymbol || 'BINANCE:BTCUSDT');
  const iv = { '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '1h': '60' }[interval] || '5';
  return `https://www.tradingview.com/chart/?symbol=${sym}&interval=${iv}`;
}

export function buildStudies(config) {
  const id = config.pineStudyId?.trim();
  if (id) return [id];
  return [];
}
