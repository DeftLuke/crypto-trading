/**
 * Binance public WebSocket — single multiplexed connection (SUBSCRIBE) for mark prices + klines.
 * Avoids opening one socket per symbol (was causing hundreds of connections).
 */
import WebSocket from 'ws';
import { config } from '../config/index.js';

const MAX_STREAMS = 120;

class BinanceWebSocket {
  constructor() {
    this.subscribers = new Map();
    this.prices = new Map();
    this.streams = new Set();
    this.ws = null;
    this.reconnectTimer = null;
    this.msgId = 1;
    this.connecting = false;
  }

  subscribeKline(symbol, interval, callback) {
    const sym = symbol.toUpperCase();
    const stream = `${sym.toLowerCase()}@kline_${interval}`;
    const key = `kline:${sym}:${interval}`;

    if (!this.subscribers.has(key)) this.subscribers.set(key, new Set());
    this.subscribers.get(key).add(callback);
    this._ensureStream(stream);

    return () => {
      const subs = this.subscribers.get(key);
      if (subs) subs.delete(callback);
    };
  }

  subscribeMarkPrice(symbol, callback) {
    const sym = symbol.toUpperCase();
    const stream = `${sym.toLowerCase()}@markPrice@1s`;
    const key = `mark:${sym}`;

    if (!this.subscribers.has(key)) this.subscribers.set(key, new Set());
    this.subscribers.get(key).add(callback);
    this._ensureStream(stream);

    return () => {
      const subs = this.subscribers.get(key);
      if (subs) subs.delete(callback);
    };
  }

  getPrice(symbol) {
    return this.prices.get(String(symbol || '').toUpperCase());
  }

  _ensureStream(stream) {
    if (this.streams.has(stream)) return;
    if (this.streams.size >= MAX_STREAMS) return;
    this.streams.add(stream);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: [stream], id: this.msgId++ }));
    } else {
      this._connect();
    }
  }

  _connect() {
    if (this.connecting || this.ws?.readyState === WebSocket.OPEN) return;
    this.connecting = true;

    const base = config.binance.wsUrl || 'wss://fstream.binance.com';
    const url = `${base}/ws`;
    const ws = new WebSocket(url);

    ws.on('open', () => {
      this.connecting = false;
      console.log(`[WS] Multiplex connected — ${this.streams.size} streams`);
      if (this.streams.size > 0) {
        ws.send(JSON.stringify({
          method: 'SUBSCRIBE',
          params: [...this.streams],
          id: this.msgId++,
        }));
      }
    });

    ws.on('message', (raw) => {
      try {
        const envelope = JSON.parse(raw.toString());
        const data = envelope.data || envelope;
        if (data.e === 'markPriceUpdate' || data.e === 'markPrice') {
          const price = parseFloat(data.p);
          const sym = data.s;
          if (sym && price > 0) {
            this.prices.set(sym, price);
            const subs = this.subscribers.get(`mark:${sym}`);
            if (subs) subs.forEach((cb) => cb({ symbol: sym, price }));
          }
        }
        if (data.e === 'kline') {
          const k = data.k;
          const candle = {
            symbol: data.s,
            interval: k.i,
            time: Math.floor(k.t / 1000),
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
            isClosed: k.x,
          };
          const subs = this.subscribers.get(`kline:${data.s}:${k.i}`);
          if (subs) subs.forEach((cb) => cb(candle));
        }
      } catch (err) {
        console.error('[WS] Parse error:', err.message);
      }
    });

    ws.on('close', () => {
      this.connecting = false;
      this.ws = null;
      console.log('[WS] Multiplex disconnected — reconnecting…');
      if (!this.reconnectTimer) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          if (this.streams.size > 0) this._connect();
        }, 3000);
      }
    });

    ws.on('error', (err) => {
      this.connecting = false;
      console.error('[WS] Multiplex error:', err.message);
    });

    this.ws = ws;
  }

  closeAll() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.ws) {
      try { this.ws.close(); } catch { /* */ }
      this.ws = null;
    }
    this.streams.clear();
    this.subscribers.clear();
    this.connecting = false;
  }

  getStatus() {
    return {
      connected: this.ws?.readyState === WebSocket.OPEN,
      streams: this.streams.size,
      max_streams: MAX_STREAMS,
      prices_cached: this.prices.size,
      subscribers: this.subscribers.size,
    };
  }
}

export const binanceWs = new BinanceWebSocket();
