/**
 * TradingView market data via @mathieuc/tradingview
 * https://github.com/Mathieu2301/TradingView-API
 */
import TradingView from '@mathieuc/tradingview';

const CRYPTO_EXCHANGES = new Set([
  'BINANCE', 'BYBIT', 'COINBASE', 'KUCOIN', 'OKX', 'BITGET', 'GATEIO', 'MEXC', 'KRAKEN',
]);

const INTERVAL_MAP = {
  '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
  '1h': '60', '2h': '120', '4h': '240', '1d': '1D', '1w': '1W',
};

export function intervalToTvTimeframe(interval = '5m') {
  return INTERVAL_MAP[interval] || '5';
}

/** Map TradingView BINANCE id → Binance futures symbol e.g. BINANCE:BTCUSDT */
export function tvIdToBinanceSymbol(tvId) {
  if (!tvId) return null;
  const [ex, sym] = String(tvId).toUpperCase().split(':');
  if (ex !== 'BINANCE' || !sym) return null;
  const clean = sym.replace(/\.P$/i, '');
  return clean.endsWith('USDT') ? clean : `${clean}USDT`;
}

export function binanceSymbolToTvId(symbol) {
  const s = String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s) return null;
  return `BINANCE:${s}`;
}

function normalizeSearchResult(r) {
  const exchange = (r.exchange || '').split(' ')[0].toUpperCase();
  return {
    id: r.id,
    symbol: r.symbol,
    exchange,
    fullExchange: r.fullExchange,
    description: r.description,
    type: r.type,
    binanceSymbol: exchange === 'BINANCE' ? r.symbol.replace('/', '').replace(/\.P$/i, '').toUpperCase() : null,
  };
}

/** Search crypto pairs only — prefers Binance USDT perpetuals/spot */
export async function searchCryptoPairs(query, { limit = 25, offset = 0 } = {}) {
  const q = String(query || '').trim();
  if (q.length < 1) return [];

  const searches = q.includes(':')
    ? [TradingView.searchMarketV3(q, 'crypto', offset)]
    : [
      TradingView.searchMarketV3(`BINANCE:${q}`, 'crypto', 0),
      TradingView.searchMarketV3(q, 'crypto', offset),
    ];

  const batches = await Promise.all(searches);
  const seen = new Set();
  const out = [];

  for (const batch of batches) {
    for (const raw of batch) {
      const r = normalizeSearchResult(raw);
      if (seen.has(r.id)) continue;

      const ex = r.exchange;
      const type = (r.type || '').toLowerCase();
      const isCrypto = type === 'crypto' || type === 'spot' || type === 'swap' || type === 'futures';
      const isExchange = CRYPTO_EXCHANGES.has(ex) || ex === 'CRYPTO';

      if (!isCrypto || !isExchange) continue;

      seen.add(r.id);
      out.push(r);
      if (out.length >= limit) break;
    }
    if (out.length >= limit) break;
  }

  return out.sort((a, b) => {
    const score = (x) => (
      (x.exchange === 'BINANCE' ? 100 : 0)
      + (x.symbol.includes('USDT') ? 50 : 0)
      + (x.symbol.toUpperCase().includes(q.toUpperCase()) ? 10 : 0)
    );
    return score(b) - score(a);
  });
}

/** One-shot candle fetch from TradingView websocket session */
export function fetchTvCandles(tvSymbol, interval = '5m', range = 300) {
  const timeframe = intervalToTvTimeframe(interval);

  return new Promise((resolve, reject) => {
    const client = new TradingView.Client();
    const chart = new client.Session.Chart();
    let settled = false;

    const finish = (fn) => {
      if (settled) return;
      settled = true;
      try { chart.delete(); client.end(); } catch { /* closed */ }
      fn();
    };

    const timer = setTimeout(() => finish(() => reject(new Error('TradingView chart timeout'))), 35000);

    chart.onError((...err) => {
      clearTimeout(timer);
      finish(() => reject(new Error(err.filter(Boolean).join(' ') || 'TradingView chart error')));
    });

    chart.onSymbolLoaded(() => {});

    chart.onUpdate(() => {
      if (chart.periods.length < Math.min(range, 30)) return;
      clearTimeout(timer);

      const candles = [...chart.periods]
        .sort((a, b) => a.time - b.time)
        .slice(-range)
        .map((p) => ({
          time: p.time,
          open: p.open,
          high: p.max,
          low: p.min,
          close: p.close,
          volume: p.volume,
        }));

      const info = chart.infos || {};
      finish(() => resolve({
        tvSymbol,
        interval,
        timeframe,
        candles,
        info: {
          description: info.description || info.short_description,
          exchange: info.exchange || info.listed_exchange,
          type: info.type,
          currency: info.currency_code,
          full_name: info.full_name || info.pro_name,
        },
      }));
    });

    chart.setMarket(tvSymbol, { timeframe, range });
  });
}

export async function getTvChart(symbolOrTvId, interval = '5m', range = 300) {
  const tvSymbol = String(symbolOrTvId).includes(':')
    ? String(symbolOrTvId).toUpperCase()
    : binanceSymbolToTvId(symbolOrTvId);

  if (!tvSymbol) throw new Error('Invalid symbol');

  const binanceSymbol = tvIdToBinanceSymbol(tvSymbol)
    || (String(symbolOrTvId).includes(':') ? null : String(symbolOrTvId).toUpperCase());

  try {
    const data = await fetchTvCandles(tvSymbol, interval, range);
    if (data.candles?.length) {
      return { ...data, binanceSymbol, source: 'tradingview' };
    }
  } catch {
    /* fall through to Binance */
  }

  if (binanceSymbol) {
    const { getKlines, parseKlines } = await import('./binance.js');
    const raw = await getKlines(binanceSymbol, interval, range);
    const candles = parseKlines(raw);
    if (candles.length) {
      return {
        tvSymbol,
        interval,
        binanceSymbol,
        source: 'binance',
        candles,
        info: { description: binanceSymbol.replace('USDT', '/USDT'), exchange: 'BINANCE' },
      };
    }
  }

  throw new Error(`No chart data for ${tvSymbol}`);
}

export async function testTradingViewConnection() {
  try {
    const rs = await searchCryptoPairs('BTC', { limit: 3 });
    return { ok: true, sample: rs[0]?.id || null };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
