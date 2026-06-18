/** WebSocket fan-out to analytics dashboard (set from index.js at boot). */
let broadcastFn = null;

export function setWsBroadcast(fn) {
  broadcastFn = fn;
}

export function dashboardBroadcast(payload) {
  if (typeof broadcastFn === 'function') {
    try {
      broadcastFn(payload);
    } catch {
      /* ignore */
    }
  }
}

export function broadcastTelegramPipeline(message, stage) {
  const sig = message?.parsed_signal || {};
  const group = message?.telegram_signal_sources?.title || message?.telegram_chat_id;
  dashboardBroadcast({
    type: 'telegram_pipeline',
    stage,
    message_id: message?.id,
    group,
    symbol: sig.symbol,
    side: sig.side,
    parse_status: message?.parse_status,
    passed: message?.api_result?.passed,
    reason: message?.api_result?.reason,
    ts: Date.now(),
  });
}

export function broadcastTradeEvent(action, trade, extra = {}) {
  dashboardBroadcast({
    type: 'trade_event',
    action,
    symbol: trade?.symbol,
    direction: trade?.direction,
    pnl: trade?.pnl ?? trade?.profit_usd,
    trade_id: trade?.id,
    ts: Date.now(),
    ...extra,
  });
}
