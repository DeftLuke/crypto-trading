/**
 * Layer 3 — Liquidity filter via DexScreener (free, no key).
 * Rugcheck optional via RUGCHECK_API_KEY.
 */

export const DEFAULT_LIQUIDITY_RULES = {
  minLiquidityUsd: 200_000,
  minVolume24hUsd: 200_000,
  minFdvUsd: 500_000,
  maxPriceImpactPct: 5,
  requirePaidDex: false,
};

export async function fetchTokenLiquidity(mintAddress, chain = 'solana') {
  if (!mintAddress) return { ok: false, reason: 'no_mint' };

  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${mintAddress}`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (!res.ok) return { ok: false, reason: `dexscreener_${res.status}` };
    const data = await res.json();
    const pairs = (data.pairs || []).filter((p) => p.chainId === chain || chain === 'solana');
    if (!pairs.length) return { ok: false, reason: 'no_pairs' };

    const best = pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    return {
      ok: true,
      mint: mintAddress,
      symbol: best.baseToken?.symbol || '?',
      name: best.baseToken?.name || '',
      priceUsd: Number(best.priceUsd || 0),
      liquidityUsd: Number(best.liquidity?.usd || 0),
      volume24hUsd: Number(best.volume?.h24 || 0),
      fdvUsd: Number(best.fdv || 0),
      marketCapUsd: Number(best.marketCap || 0),
      pairUrl: best.url,
      dexId: best.dexId,
      pairAddress: best.pairAddress,
    };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

export async function fetchRugcheck(mintAddress) {
  const key = process.env.RUGCHECK_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mintAddress}/report`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export function evaluateLiquidity(tokenData, rules = DEFAULT_LIQUIDITY_RULES) {
  if (!tokenData?.ok) {
    return { passed: false, reasons: [tokenData?.reason || 'unknown'], token: tokenData };
  }

  const reasons = [];
  if (tokenData.liquidityUsd < rules.minLiquidityUsd) {
    reasons.push(`liquidity $${Math.round(tokenData.liquidityUsd)} < $${rules.minLiquidityUsd}`);
  }
  if (tokenData.volume24hUsd < rules.minVolume24hUsd) {
    reasons.push(`volume24h $${Math.round(tokenData.volume24hUsd)} < $${rules.minVolume24hUsd}`);
  }
  if (rules.minFdvUsd && tokenData.fdvUsd > 0 && tokenData.fdvUsd < rules.minFdvUsd) {
    reasons.push(`fdv $${Math.round(tokenData.fdvUsd)} < $${rules.minFdvUsd}`);
  }

  return {
    passed: reasons.length === 0,
    reasons,
    token: tokenData,
    safety_score: reasons.length === 0 ? 100 : Math.max(0, 100 - reasons.length * 30),
  };
}

export async function checkTokenSafety(mintAddress, rules = DEFAULT_LIQUIDITY_RULES) {
  const tokenData = await fetchTokenLiquidity(mintAddress);
  const evaluation = evaluateLiquidity(tokenData, rules);
  const rugcheck = await fetchRugcheck(mintAddress);
  if (rugcheck?.score != null && rugcheck.score < 5000) {
    evaluation.passed = false;
    evaluation.reasons.push(`rugcheck score ${rugcheck.score} (risky)`);
  }
  evaluation.rugcheck = rugcheck;
  return evaluation;
}
