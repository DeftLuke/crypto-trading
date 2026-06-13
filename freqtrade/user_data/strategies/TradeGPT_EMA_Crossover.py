"""
TradeGPT EMA Crossover — classic trend-following Freqtrade strategy.
Good baseline for backtesting and hyperopt on Binance futures.
"""
from freqtrade.strategy import IStrategy, IntParameter
from pandas import DataFrame
import talib.abstract as ta


class TradeGPT_EMA_Crossover(IStrategy):
    INTERFACE_VERSION = 3

    timeframe = "5m"
    can_short = True

    minimal_roi = {"0": 0.03, "40": 0.02, "100": 0.01}
    stoploss = -0.05

    buy_ema_fast = IntParameter(5, 15, default=9, space="buy")
    buy_ema_slow = IntParameter(18, 30, default=21, space="buy")

    startup_candle_count = 40

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        fast = int(self.buy_ema_fast.value)
        slow = int(self.buy_ema_slow.value)
        dataframe["ema_fast"] = ta.EMA(dataframe, timeperiod=fast)
        dataframe["ema_slow"] = ta.EMA(dataframe, timeperiod=slow)
        dataframe["rsi"] = ta.RSI(dataframe, timeperiod=14)
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        cross_up = (
            (dataframe["ema_fast"] > dataframe["ema_slow"])
            & (dataframe["ema_fast"].shift(1) <= dataframe["ema_slow"].shift(1))
        )
        cross_down = (
            (dataframe["ema_fast"] < dataframe["ema_slow"])
            & (dataframe["ema_fast"].shift(1) >= dataframe["ema_slow"].shift(1))
        )

        dataframe.loc[(cross_up & (dataframe["rsi"] < 55)), "enter_long"] = 1
        dataframe.loc[(cross_down & (dataframe["rsi"] > 45)), "enter_short"] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (dataframe["ema_fast"] < dataframe["ema_slow"]),
            "exit_long",
        ] = 1
        dataframe.loc[
            (dataframe["ema_fast"] > dataframe["ema_slow"]),
            "exit_short",
        ] = 1
        return dataframe
