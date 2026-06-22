"""Binance Vision archive market data — local Parquet only (no Supabase OHLCV)."""

from app.market_data.manager import MarketDataManager

__all__ = ["MarketDataManager"]
