/**
 * Layer 2 — Wallet consensus engine
 */
import { checkTokenSafety, DEFAULT_LIQUIDITY_RULES } from './liquidity.js';

export const DEFAULT_CONSENSUS_RULES = {
  minWallets: 5,
  minAvgScore: 80,
  minWalletScore: 70,
  windowHours: 2,
};

export function buildWalletScoreMap(wallets) {
  const map = new Map();
  for (const w of wallets) {
    if (w.status === 'removed') continue;
    if (w.score >= DEFAULT_CONSENSUS_RULES.minWalletScore || w.qualified) {
      map.set(w.address.toLowerCase(), w);
    }
  }
  return map;
}

export function detectConsensus(trades, walletMap, rules = DEFAULT_CONSENSUS_RULES) {
  const cutoff = Date.now() - rules.windowHours * 3600 * 1000;
  const byToken = new Map();

  for (const t of trades) {
    const ts = new Date(t.timestamp).getTime();
    if (ts < cutoff) continue;

    const wallet = walletMap.get(t.trader.toLowerCase());
    if (!wallet || wallet.score < rules.minWalletScore) continue;

    const key = t.token_mint.toLowerCase();
    if (!byToken.has(key)) {
      byToken.set(key, {
        token_mint: t.token_mint,
        symbol: t.symbol,
        wallets: new Map(),
        first_seen: t.timestamp,
        last_seen: t.timestamp,
      });
    }
    const group = byToken.get(key);
    group.wallets.set(wallet.address, wallet);
    if (new Date(t.timestamp) > new Date(group.last_seen)) group.last_seen = t.timestamp;
    if (new Date(t.timestamp) < new Date(group.first_seen)) group.first_seen = t.timestamp;
  }

  const candidates = [];
  for (const [, group] of byToken) {
    const walletList = [...group.wallets.values()];
    const count = walletList.length;
    if (count < rules.minWallets) continue;

    const avgScore = walletList.reduce((s, w) => s + w.score, 0) / count;
    if (avgScore < rules.minAvgScore) continue;

    candidates.push({
      token_mint: group.token_mint,
      symbol: group.symbol,
      wallet_count: count,
      avg_wallet_score: Math.round(avgScore * 10) / 10,
      wallets: walletList.map((w) => ({
        address: w.address,
        score: w.score,
        win_rate: w.metrics.win_rate,
        roi_90d: w.metrics.roi_90d,
      })),
      first_seen: group.first_seen,
      last_seen: group.last_seen,
      confidence: Math.min(100, Math.round(avgScore * 0.6 + count * 4)),
    });
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

export async function applyLiquidityFilter(candidates, liquidityRules = DEFAULT_LIQUIDITY_RULES) {
  const results = [];
  for (const c of candidates) {
    const safety = await checkTokenSafety(c.token_mint, liquidityRules);
    results.push({
      ...c,
      liquidity: safety,
      passed_liquidity: safety.passed,
      signal: safety.passed ? 'BUY' : 'FILTERED',
    });
    await new Promise((r) => setTimeout(r, 300));
  }
  return results;
}

export function filterPassedSignals(signals) {
  return signals.filter((s) => s.passed_liquidity && s.signal === 'BUY');
}
