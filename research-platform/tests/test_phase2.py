import polars as pl
import pytest

from app.indicators.engine import compute_all_indicators, serialize_indicators
from app.indicators.registry import ADXIndicator, BollingerIndicator, OBVIndicator, ROCIndicator
from app.signals.confluence import ConfluenceEngine
from app.signals.rules_engine import StrategyRule, StrategyRulesEngine
from app.signals.telegram_formatter import TelegramSignalFormatter
from app.signals.volatility import VolatilityFilter
from app.smc.engine import SmcEngine


@pytest.fixture
def ohlcv(n: int = 300) -> pl.DataFrame:
    return pl.DataFrame({
        "ts": [1_700_000_000_000 + i * 900_000 for i in range(n)],
        "open": [100.0 + (i % 20) * 0.5 for i in range(n)],
        "high": [101.0 + (i % 20) * 0.5 for i in range(n)],
        "low": [99.0 + (i % 20) * 0.5 for i in range(n)],
        "close": [100.5 + (i % 20) * 0.5 for i in range(n)],
        "volume": [1000.0 + i * 10 for i in range(n)],
    })


def test_all_indicators_compute(ohlcv: pl.DataFrame):
    df = compute_all_indicators(ohlcv.lazy())
    assert len(df) == len(ohlcv)
    for col in ("ema20", "ema100", "rsi14", "atr14", "macd", "vwap", "adx", "obv", "roc"):
        assert col in df.columns


def test_serialize_indicators(ohlcv: pl.DataFrame):
    df = compute_all_indicators(ohlcv.lazy())
    row = df.tail(1).to_dicts()[0]
    out = serialize_indicators(row)
    assert "rsi" in out
    assert "atr" in out


def test_adx_bollinger_obv(ohlcv: pl.DataFrame):
    lf = ohlcv.lazy()
    assert "adx" in ADXIndicator().calculate(lf).collect().columns
    assert "bb_upper" in BollingerIndicator().calculate(lf).collect().columns
    assert "obv" in OBVIndicator().calculate(lf).collect().columns
    assert "roc" in ROCIndicator().calculate(lf).collect().columns


def test_smc_bos_detection():
    # Uptrend with clear swing break at end
    n = 30
    closes = [100.0] * 10 + [100 + i for i in range(1, 21)]
    highs = [c + 2 for c in closes]
    lows = [c - 2 for c in closes]
    df = pl.DataFrame({
        "ts": [1_700_000_000_000 + i * 900_000 for i in range(n)],
        "open": closes, "high": highs, "low": lows, "close": closes,
        "volume": [1000.0] * n,
    })
    engine = SmcEngine(swing_lookback=2, min_impulse_pct=0.001)
    result = engine.analyze(df)
    assert len(result.bars) == n
    assert len(result.swing_highs) > 0 or len(result.zones) > 0


def test_smc_fvg_detection():
    df = pl.DataFrame({
        "ts": [1, 2, 3],
        "open": [100.0, 102.0, 106.0],
        "high": [101.0, 103.0, 107.0],
        "low": [99.0, 101.0, 105.0],
        "close": [100.5, 102.5, 106.5],
        "volume": [1000.0, 1000.0, 1000.0],
    })
    result = SmcEngine(swing_lookback=1).analyze(df)
    assert any(b.fvg for b in result.bars)


def test_confluence_scoring():
    engine = ConfluenceEngine()
    result = engine.score(
        {"ema100": 100, "close": 95, "15m_rsi14": 82, "1h_ema100": 100, "15m_close": 95},
        {"bos": True, "bos_type": "bearish", "liquidity_sweep": True, "sweep_direction": "sellside",
         "order_block": True, "order_block_direction": "bearish"},
        "SHORT",
    )
    assert 0 < result.score <= 100
    assert result.breakdown


def test_rules_engine():
    engine = StrategyRulesEngine()
    rule = StrategyRule(id=1, name="test", direction="SHORT", conditions=[
        {"field": "rsi14", "op": ">", "value": 80},
    ])
    assert engine.evaluate_rule(rule, {"rsi14": 85})
    assert not engine.evaluate_rule(rule, {"rsi14": 50})


def test_volatility_filter(ohlcv: pl.DataFrame):
    result = VolatilityFilter(threshold_pct=30).evaluate(ohlcv)
    assert result.safe is True
    assert "volatility" in result.to_dict() or hasattr(result, "volatility_pct")


def test_telegram_formatter():
    text = TelegramSignalFormatter().format({
        "symbol": "BTCUSDT", "direction": "SHORT", "confidence": 90,
        "entry": 102500, "stop_loss": 103000, "tp1": 102000, "tp2": 101500, "tp3": "trail",
        "indicators": {"rsi14": 82, "1h_ema100": 103000},
        "smc": {"bos": True, "order_block": True, "liquidity_sweep": True},
        "metadata": {"volatility": {"volatility": 12}},
    })
    assert "BTCUSDT" in text
    assert "SHORT" in text
    assert "90" in text
