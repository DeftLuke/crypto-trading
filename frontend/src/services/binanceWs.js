const WS_BASE = import.meta.env.VITE_BINANCE_WS || 'wss://fstream.binance.com/ws';

export function subscribeKline(symbol, interval, onCandle) {
  const stream = `${symbol.toLowerCase()}@kline_${interval}`;
  let ws;
  let closed = false;

  function connect() {
    ws = new WebSocket(`${WS_BASE}/${stream}`);
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.e !== 'kline') return;
      const k = msg.k;
      onCandle({
        time: Math.floor(k.t / 1000),
        open: parseFloat(k.o),
        high: parseFloat(k.h),
        low: parseFloat(k.l),
        close: parseFloat(k.c),
        volume: parseFloat(k.v),
        isClosed: k.x,
      });
    };
    ws.onclose = () => {
      if (!closed) setTimeout(connect, 3000);
    };
  }

  connect();
  return () => {
    closed = true;
    ws?.close();
  };
}

export function subscribeMarkPrice(symbol, onPrice) {
  const stream = `${symbol.toLowerCase()}@markPrice@1s`;
  const ws = new WebSocket(`${WS_BASE}/${stream}`);

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    onPrice({ symbol: msg.s, price: parseFloat(msg.p) });
  };

  ws.onerror = () => ws.close();
  return () => ws.close();
}
