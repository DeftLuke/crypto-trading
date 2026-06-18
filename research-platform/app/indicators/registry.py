"""All Phase 2 indicator implementations."""

import polars as pl

from app.indicators.base import BaseIndicator


class EMAIndicator(BaseIndicator):
    def __init__(self, period: int) -> None:
        self.period = period
        self.name = f"ema{period}"
        self.output_columns = [self.name]

    def calculate(self, lf: pl.LazyFrame) -> pl.LazyFrame:
        return lf.select([
            "ts",
            pl.col("close").ewm_mean(span=self.period, adjust=False).alias(self.name),
        ])


class RSIIndicator(BaseIndicator):
    def __init__(self, period: int = 14) -> None:
        self.period = period
        self.name = f"rsi{period}"
        self.output_columns = [self.name]

    def calculate(self, lf: pl.LazyFrame) -> pl.LazyFrame:
        delta = pl.col("close").diff()
        gain = delta.clip(lower_bound=0)
        loss = (-delta).clip(lower_bound=0)
        avg_gain = gain.ewm_mean(span=self.period, adjust=False)
        avg_loss = loss.ewm_mean(span=self.period, adjust=False)
        rs = avg_gain / avg_loss
        return lf.select(["ts", (100 - (100 / (1 + rs))).alias(self.name)])


class ATRIndicator(BaseIndicator):
    def __init__(self, period: int = 14) -> None:
        self.period = period
        self.name = f"atr{period}"
        self.output_columns = [self.name]

    def calculate(self, lf: pl.LazyFrame) -> pl.LazyFrame:
        prev_close = pl.col("close").shift(1)
        tr = pl.max_horizontal(
            pl.col("high") - pl.col("low"),
            (pl.col("high") - prev_close).abs(),
            (pl.col("low") - prev_close).abs(),
        )
        return lf.select(["ts", tr.ewm_mean(span=self.period, adjust=False).alias(self.name)])


class MACDIndicator(BaseIndicator):
    name = "macd"
    output_columns = ["macd", "macd_signal", "macd_hist"]

    def calculate(self, lf: pl.LazyFrame) -> pl.LazyFrame:
        ema12 = pl.col("close").ewm_mean(span=12, adjust=False)
        ema26 = pl.col("close").ewm_mean(span=26, adjust=False)
        macd_line = ema12 - ema26
        signal = macd_line.ewm_mean(span=9, adjust=False)
        return lf.select([
            "ts",
            macd_line.alias("macd"),
            signal.alias("macd_signal"),
            (macd_line - signal).alias("macd_hist"),
        ])


class VWAPIndicator(BaseIndicator):
    name = "vwap"
    output_columns = ["vwap"]

    def calculate(self, lf: pl.LazyFrame) -> pl.LazyFrame:
        typical = (pl.col("high") + pl.col("low") + pl.col("close")) / 3
        return lf.select([
            "ts",
            (typical * pl.col("volume")).cum_sum().alias("_tpv"),
            pl.col("volume").cum_sum().alias("_vol"),
        ]).select(["ts", (pl.col("_tpv") / pl.col("_vol")).alias("vwap")])


class ADXIndicator(BaseIndicator):
    name = "adx"
    output_columns = ["adx", "plus_di", "minus_di"]

    def __init__(self, period: int = 14) -> None:
        self.period = period

    def calculate(self, lf: pl.LazyFrame) -> pl.LazyFrame:
        df = lf.collect()
        if df.is_empty():
            return df.lazy().select("ts", pl.lit(None).alias("adx"))
        high = df["high"].to_list()
        low = df["low"].to_list()
        close = df["close"].to_list()
        n = len(df)
        plus_dm, minus_dm, tr_list = [], [], []
        for i in range(n):
            if i == 0:
                plus_dm.append(0.0)
                minus_dm.append(0.0)
                tr_list.append(high[i] - low[i])
                continue
            up = high[i] - high[i - 1]
            down = low[i - 1] - low[i]
            plus_dm.append(up if up > down and up > 0 else 0.0)
            minus_dm.append(down if down > up and down > 0 else 0.0)
            tr_list.append(max(high[i] - low[i], abs(high[i] - close[i - 1]), abs(low[i] - close[i - 1])))

        def wilder_smooth(values: list[float], period: int) -> list[float | None]:
            out: list[float | None] = [None] * len(values)
            if len(values) < period:
                return out
            s = sum(values[:period])
            out[period - 1] = s
            for i in range(period, len(values)):
                s = s - (s / period) + values[i]
                out[i] = s
            return out

        tr_s = wilder_smooth(tr_list, self.period)
        pdm_s = wilder_smooth(plus_dm, self.period)
        mdm_s = wilder_smooth(minus_dm, self.period)
        adx_vals: list[float | None] = [None] * n
        dx_list: list[float | None] = [None] * n
        for i in range(n):
            if tr_s[i] and tr_s[i] != 0 and pdm_s[i] is not None:
                pdi = 100 * pdm_s[i] / tr_s[i]
                mdi = 100 * mdm_s[i] / tr_s[i] if mdm_s[i] else 0
                dx = abs(pdi - mdi) / (pdi + mdi) * 100 if (pdi + mdi) else 0
                dx_list[i] = dx
        dx_clean = [d if d is not None else 0.0 for d in dx_list]
        adx_smooth = wilder_smooth(dx_clean, self.period)
        for i in range(n):
            adx_vals[i] = adx_smooth[i]
        pdi_out = [100 * pdm_s[i] / tr_s[i] if tr_s[i] else None for i in range(n)]
        mdi_out = [100 * mdm_s[i] / tr_s[i] if tr_s[i] else None for i in range(n)]
        return pl.DataFrame({
            "ts": df["ts"],
            "adx": adx_vals,
            "plus_di": pdi_out,
            "minus_di": mdi_out,
        }).lazy()


class BollingerIndicator(BaseIndicator):
    name = "bb"
    output_columns = ["bb_upper", "bb_middle", "bb_lower"]

    def __init__(self, period: int = 20, std_dev: float = 2.0) -> None:
        self.period = period
        self.std_dev = std_dev

    def calculate(self, lf: pl.LazyFrame) -> pl.LazyFrame:
        mid = pl.col("close").rolling_mean(self.period)
        std = pl.col("close").rolling_std(self.period)
        return lf.select([
            "ts",
            mid.alias("bb_middle"),
            (mid + self.std_dev * std).alias("bb_upper"),
            (mid - self.std_dev * std).alias("bb_lower"),
        ])


class StochRSIIndicator(BaseIndicator):
    name = "stoch_rsi"
    output_columns = ["stoch_rsi", "stoch_rsi_k", "stoch_rsi_d"]

    def __init__(self, rsi_period: int = 14, stoch_period: int = 14, k: int = 3, d: int = 3) -> None:
        self.rsi_period = rsi_period
        self.stoch_period = stoch_period
        self.k = k
        self.d = d

    def calculate(self, lf: pl.LazyFrame) -> pl.LazyFrame:
        rsi_lf = RSIIndicator(self.rsi_period).calculate(lf)
        df = rsi_lf.collect()
        col = f"rsi{self.rsi_period}"
        rsi = df[col].to_list()
        stoch: list[float | None] = [None] * len(rsi)
        for i in range(self.stoch_period - 1, len(rsi)):
            window = [r for r in rsi[i - self.stoch_period + 1 : i + 1] if r is not None]
            if not window:
                continue
            lo, hi = min(window), max(window)
            stoch[i] = (rsi[i] - lo) / (hi - lo) * 100 if hi != lo and rsi[i] is not None else 50.0
        out = pl.DataFrame({"ts": df["ts"], "stoch_rsi": stoch})
        out = out.with_columns([
            pl.col("stoch_rsi").rolling_mean(self.k).alias("stoch_rsi_k"),
        ]).with_columns([
            pl.col("stoch_rsi_k").rolling_mean(self.d).alias("stoch_rsi_d"),
        ])
        return out.lazy()


class ROCIndicator(BaseIndicator):
    name = "roc"
    output_columns = ["roc"]

    def __init__(self, period: int = 12) -> None:
        self.period = period

    def calculate(self, lf: pl.LazyFrame) -> pl.LazyFrame:
        prev = pl.col("close").shift(self.period)
        return lf.select(["ts", ((pl.col("close") - prev) / prev * 100).alias("roc")])


class RelativeVolumeIndicator(BaseIndicator):
    name = "rel_volume"
    output_columns = ["rel_volume"]

    def __init__(self, period: int = 20) -> None:
        self.period = period

    def calculate(self, lf: pl.LazyFrame) -> pl.LazyFrame:
        avg = pl.col("volume").rolling_mean(self.period)
        return lf.select(["ts", (pl.col("volume") / avg).alias("rel_volume")])


class OBVIndicator(BaseIndicator):
    name = "obv"
    output_columns = ["obv"]

    def calculate(self, lf: pl.LazyFrame) -> pl.LazyFrame:
        direction = (
            pl.when(pl.col("close") > pl.col("close").shift(1))
            .then(pl.col("volume"))
            .when(pl.col("close") < pl.col("close").shift(1))
            .then(-pl.col("volume"))
            .otherwise(0)
        )
        return lf.select(["ts", direction.cum_sum().alias("obv")])


class VolumeDeltaIndicator(BaseIndicator):
    """Volume delta interface — estimates buy/sell delta from candle body."""

    name = "volume_delta"
    output_columns = ["volume_delta", "volume_delta_pct"]

    def calculate(self, lf: pl.LazyFrame) -> pl.LazyFrame:
        body = pl.col("close") - pl.col("open")
        range_ = pl.col("high") - pl.col("low")
        ratio = pl.when(range_ > 0).then(body / range_).otherwise(0)
        delta = ratio * pl.col("volume")
        return lf.select([
            "ts",
            delta.alias("volume_delta"),
            (delta / pl.col("volume") * 100).alias("volume_delta_pct"),
        ])


ALL_INDICATORS: list[BaseIndicator] = [
    EMAIndicator(20),
    EMAIndicator(50),
    EMAIndicator(100),
    EMAIndicator(200),
    RSIIndicator(14),
    ATRIndicator(14),
    MACDIndicator(),
    VWAPIndicator(),
    ADXIndicator(14),
    BollingerIndicator(20, 2.0),
    StochRSIIndicator(),
    ROCIndicator(12),
    RelativeVolumeIndicator(20),
    OBVIndicator(),
    VolumeDeltaIndicator(),
]

DEFAULT_INDICATORS = ALL_INDICATORS
