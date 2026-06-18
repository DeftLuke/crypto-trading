"""Leverage fallback — 50 → 25 → 20 → 10 → 5."""

LEVERAGE_CHAIN = [50, 25, 20, 10, 5, 1]


def leverage_fallback_chain(preferred: int) -> list[int]:
    chain = [lev for lev in LEVERAGE_CHAIN if lev <= preferred]
    if preferred not in chain and preferred > 0:
        chain = sorted(set([preferred] + chain), reverse=True)
    return chain or [1]
