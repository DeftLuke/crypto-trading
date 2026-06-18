/** Wallet scoring & filter rules (Layer 1) */

export const DEFAULT_RULES = {
  minWinRate: 0.55,
  minRoi90d: 50,
  minProfitFactor: 1.5,
  minTrades: 20,
  maxWallets: 1000,
  targetWallets: 750,
};

export function parseWinRate(val) {
  if (val == null) return 0;
  const n = Number(String(val).replace('%', ''));
  if (Number.isNaN(n)) return 0;
  return n > 1 ? n / 100 : n;
}

export function normalizeWalletRow(row, chain = 'solana') {
  const address = (
    row.Trader || row.trader || row.wallet_address || row.wallet || row.address
  )?.trim();
  if (!address) return null;

  const buyTx = Number(row.buy_tx ?? 0);
  const sellTx = Number(row.sell_tx ?? 0);
  const tradeCount = Number(
    row['# of trades'] ?? row.num_trades ?? row.trade_count ?? row.trades
      ?? (buyTx + sellTx > 0 ? buyTx + sellTx : 0)
  );
  const avgRoi = Number(
    row['Avg ROI per token'] ?? row.avg_roi ?? row.avg_roi_per_token ?? row.roi_90d ?? 0
  );
  const winRate = parseWinRate(row.win_rate ?? row['win_rate'] ?? row.winrate);
  const spent = Number(row.Spent ?? row.spent ?? row.spent_usd ?? row.buy_volume ?? 0);
  const received = Number(row.Received ?? row.received ?? row.received_usd ?? row.sell_volume ?? 0);
  const profit = Number(row.Profit ?? row.profit ?? row.profit_usd ?? row.pnl ?? received - spent);
  const solBalance = Number(row.sol_balance ?? row['sol_balance'] ?? 0);

  const profitFactor = spent > 0 ? received / spent : profit > 0 && spent > 0 ? (spent + profit) / spent : 0;

  return {
    address,
    chain,
    trade_count: tradeCount,
    roi_30d: Number(row.roi_30d ?? avgRoi * 0.35),
    roi_90d: Number(row.roi_90d ?? avgRoi),
    win_rate: winRate,
    avg_holding_hours: Number(row.avg_holding_hours ?? row.avg_hold_hours ?? 24),
    profit_factor: Number(row.profit_factor ?? profitFactor),
    max_drawdown: Number(row.max_drawdown ?? row.max_dd ?? 0),
    profit_usd: profit,
    spent_usd: spent,
    received_usd: received,
    sol_balance: solBalance,
    memecoins_traded: Number(row['# of memecoins'] ?? row.memecoins ?? row.tokens ?? 0),
    buy_tx: buyTx || undefined,
    sell_tx: sellTx || undefined,
    last_trade_days_ago: Number(row['Last trade was {} days ago'] ?? row.last_trade_days ?? 999),
    raw: row,
  };
}

export function computeWalletScore(metrics, rules = DEFAULT_RULES) {
  let score = 0;

  // Win rate (0-25)
  if (metrics.win_rate >= rules.minWinRate) {
    score += Math.min(25, ((metrics.win_rate - rules.minWinRate) / 0.45) * 25);
  }

  // 90d ROI (0-25)
  if (metrics.roi_90d >= rules.minRoi90d) {
    score += Math.min(25, ((metrics.roi_90d - rules.minRoi90d) / 200) * 25);
  }

  // Profit factor (0-20)
  if (metrics.profit_factor >= rules.minProfitFactor) {
    score += Math.min(20, ((metrics.profit_factor - rules.minProfitFactor) / 3) * 20);
  }

  // Trade count (0-15)
  if (metrics.trade_count >= rules.minTrades) {
    score += Math.min(15, ((metrics.trade_count - rules.minTrades) / 200) * 15);
  }

  // Consistency — low drawdown + recent activity (0-15)
  const ddPenalty = metrics.max_drawdown > 0 ? Math.min(10, metrics.max_drawdown / 10) : 0;
  const activityBonus = metrics.last_trade_days_ago <= 7 ? 10 : metrics.last_trade_days_ago <= 30 ? 5 : 0;
  score += Math.max(0, 15 - ddPenalty + activityBonus * 0.5);

  return Math.round(Math.min(100, Math.max(0, score)));
}

export function passesFilter(metrics, rules = DEFAULT_RULES) {
  return (
    metrics.win_rate >= rules.minWinRate
    && metrics.roi_90d >= rules.minRoi90d
    && metrics.profit_factor >= rules.minProfitFactor
    && metrics.trade_count >= rules.minTrades
  );
}

export function enrichWallet(raw, rules = DEFAULT_RULES) {
  const metrics = typeof raw.metrics === 'object' && raw.address
    ? raw.metrics
    : normalizeWalletRow(raw.raw || raw);
  if (!metrics?.address) return null;

  const score = computeWalletScore(metrics, rules);
  const qualified = passesFilter(metrics, rules);

  return {
    address: metrics.address,
    chain: metrics.chain || 'solana',
    score,
    qualified,
    status: raw.status || (qualified ? 'active' : 'candidate'),
    metrics,
    score_history: raw.score_history || [],
    added_at: raw.added_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export function detectDecliningWallets(wallets, { scoreDropThreshold = 15, roiDropThreshold = 20 } = {}) {
  const declining = [];
  for (const w of wallets) {
    if (!w.score_history?.length) continue;
    const prev = w.score_history[w.score_history.length - 1];
    const scoreDrop = (prev?.score ?? w.score) - w.score;
    const roiDrop = (prev?.roi_90d ?? w.metrics.roi_90d) - w.metrics.roi_90d;
    if (scoreDrop >= scoreDropThreshold || roiDrop >= roiDropThreshold || w.metrics.profit_usd < 0) {
      declining.push({ wallet: w, scoreDrop, roiDrop, reason: w.metrics.profit_usd < 0 ? 'negative_pnl' : 'score_decline' });
    }
  }
  return declining;
}
