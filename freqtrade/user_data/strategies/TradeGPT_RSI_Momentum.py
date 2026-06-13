"""
TradeGPT RSI Momentum — Freqtrade strategy (popular RSI + EMA combo)
Aligned with TradeGPT mandatory RSI gates: buy oversold, exit overbought.

Docs: https://www.freqtrade.io/en/stable/strategy-customization/
"""
from freqtrade.strategy import IStrategy, DecimalParameter, IntParameter
from pandas import DataFrame
import talib.abstract as ta


class TradeGPT_RSI_Momentum(IStrategy):
    INTERFACE_VERSION = 3

    timeframe = "15m"
    can_short = False

    minimal_roi = {
        "0": 0.05,
        "30": 0.025,
        "60": 0.015,
        "120": 0.01,
    }

    stoploss = -0.04
    trailing_stop = True
    trailing_stop_positive = 0.01
    trailing_stop_positive_offset = 0.02
    trailing_only_offset_is_reached = True

    rsi_buy = IntParameter(20, 35, default=30, space="buy")
    rsi_sell = IntParameter(65, 80, default=70, space="sell")
    ema_fast = IntParameter(8, 16, default=12, space="buy")
    ema_slow = IntParameter(20, 34, default=26, space="buy")

    startup_candle_count = 50

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe["rsi"] = ta.RSI(dataframe, timeperiod=14)
        dataframe["ema_fast"] = ta.EMA(dataframe, timeperiod=int(self.ema_fast.value))
        dataframe["ema_slow"] = ta.EMA(dataframe, timeperiod=int(self.ema_slow.value))
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (
                (dataframe["rsi"] < self.rsi_buy.value)
                & (dataframe["ema_fast"] > dataframe["ema_slow"])
                & (dataframe["volume"] > 0)
            ),
            "enter_long",
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (
                (dataframe["rsi"] > self.rsi_sell.value)
                | (dataframe["ema_fast"] < dataframe["ema_slow"])
            ),
            "exit_long",
        ] = 1
        return dataframe
