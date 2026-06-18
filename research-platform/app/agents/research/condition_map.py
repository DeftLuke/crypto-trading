"""Condition text → backtest rule field mapping."""

CONDITION_MAP: dict[str, list[dict]] = {
    "rsi > 80": [{"field": "rsi14", "op": ">", "value": 80}],
    "rsi > 85": [{"field": "rsi14", "op": ">", "value": 85}],
    "rsi > 70": [{"field": "rsi14", "op": ">", "value": 70}],
    "rsi < 20": [{"field": "rsi14", "op": "<", "value": 20}],
    "rsi < 30": [{"field": "rsi14", "op": "<", "value": 30}],
    "ema100 bearish": [{"field": "close_below_ema100_1h", "op": "==", "value": 1, "type": "bool"}],
    "ema100 bullish": [{"field": "close_above_ema100_1h", "op": "==", "value": 1, "type": "bool"}],
    "bearish bos": [{"field": "bos_bearish", "op": "==", "value": 1, "type": "bool"}],
    "bullish bos": [{"field": "bos_bullish", "op": "==", "value": 1, "type": "bool"}],
    "ob retest": [{"field": "ob_bearish_retest", "op": "==", "value": 1, "type": "bool"}],
    "bearish ob retest": [{"field": "ob_bearish_retest", "op": "==", "value": 1, "type": "bool"}],
    "bullish ob retest": [{"field": "ob_bullish_retest", "op": "==", "value": 1, "type": "bool"}],
    "liquidity sweep": [{"field": "liquidity_sweep_bearish", "op": "==", "value": 1, "type": "bool"}],
    "volatility safe": [{"field": "volatility_safe", "op": "==", "value": 1, "type": "bool"}],
    "choch bearish": [{"field": "choch_bearish", "op": "==", "value": 1, "type": "bool"}],
    "choch bullish": [{"field": "choch_bullish", "op": "==", "value": 1, "type": "bool"}],
}

SESSIONS = ["Asian", "London", "New York"]

INDICATOR_CONDITIONS = ["RSI > 80", "RSI > 85", "RSI > 70", "RSI < 20", "RSI < 30"]
SMC_CONDITIONS_SHORT = ["EMA100 Bearish", "Bearish BOS", "Bearish OB Retest", "Liquidity Sweep", "CHoCH Bearish"]
SMC_CONDITIONS_LONG = ["EMA100 Bullish", "Bullish BOS", "Bullish OB Retest", "CHoCH Bullish"]


def parse_conditions(text_conditions: list[str]) -> list[dict]:
    rules: list[dict] = []
    for cond in text_conditions:
        key = cond.lower().strip()
        mapped = CONDITION_MAP.get(key)
        if mapped:
            rules.extend(mapped)
        elif "rsi" in key and ">" in key:
            try:
                val = float(key.split(">")[-1].strip())
                rules.append({"field": "rsi14", "op": ">", "value": val})
            except ValueError:
                pass
        elif "rsi" in key and "<" in key:
            try:
                val = float(key.split("<")[-1].strip())
                rules.append({"field": "rsi14", "op": "<", "value": val})
            except ValueError:
                pass
    return rules
