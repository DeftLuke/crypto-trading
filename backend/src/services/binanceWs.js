import WebSocket from 'ws';
import { config } from '../config/index.js';

class BinanceWebSocket {
  constructor() {
    this.connections = new Map();
    this.subscribers = new Map();
    this.prices = new Map();
  }

  subscribeKline(symbol, interval, callback) {
    const stream = `${symbol.toLowerCase()}@kline_${interval}`;
    const key = `kline:${symbol}:${interval}`;

    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }
    this.subscribers.get(key).add(callback);

    if (!this.connections.has(stream)) {
      this._connectStream(stream, (data) => {
        if (data.e !== 'kline') return;
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

        const subKey = `kline:${data.s}:${k.i}`;
        const subs = this.subscribers.get(subKey);
        if (subs) {
          subs.forEach((cb) => cb(candle));
        }
      });
    }

    return () => {
      const subs = this.subscribers.get(key);
      if (subs) subs.delete(callback);
    };
  }

  subscribeMarkPrice(symbol, callback) {
    const stream = `${symbol.toLowerCase()}@markPrice@1s`;
    const key = `mark:${symbol}`;

    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }
    this.subscribers.get(key).add(callback);

    if (!this.connections.has(stream)) {
      this._connectStream(stream, (data) => {
        const price = parseFloat(data.p);
        this.prices.set(data.s, price);

        const subs = this.subscribers.get(`mark:${data.s}`);
        if (subs) {
          subs.forEach((cb) => cb({ symbol: data.s, price }));
        }
      });
    }

    return () => {
      const subs = this.subscribers.get(key);
      if (subs) subs.delete(callback);
    };
  }

  getPrice(symbol) {
    return this.prices.get(symbol);
  }

  _connectStream(stream, onMessage) {
    const wsUrl = `${config.binance.wsUrl}/ws/${stream}`;
    const ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      console.log(`[WS] Connected: ${stream}`);
    });

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        onMessage(data);
      } catch (err) {
        console.error(`[WS] Parse error on ${stream}:`, err.message);
      }
    });

    ws.on('close', () => {
      console.log(`[WS] Disconnected: ${stream}, reconnecting...`);
      this.connections.delete(stream);
      setTimeout(() => {
        if (this.subscribers.size > 0) {
          this._connectStream(stream, onMessage);
        }
      }, 3000);
    });

    ws.on('error', (err) => {
      console.error(`[WS] Error on ${stream}:`, err.message);
    });

    this.connections.set(stream, ws);
  }

  closeAll() {
    for (const ws of this.connections.values()) {
      ws.close();
    }
    this.connections.clear();
    this.subscribers.clear();
  }
}

export const binanceWs = new BinanceWebSocket();
