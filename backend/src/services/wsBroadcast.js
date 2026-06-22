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

export function broadcastTelegramPipeline(message, stage, extra = {}) {
  const sig = message?.parsed_signal || {};
  const group = message?.telegram_signal_sources?.title || message?.telegram_chat_id;
  const api = message?.api_result || {};
  dashboardBroadcast({
    type: 'telegram_pipeline',
    stage,
    message_id: message?.id,
    group,
    symbol: sig.symbol || api.signal?.symbol,
    side: sig.side || api.signal?.side,
    parse_status: message?.parse_status,
    passed: api.passed,
    reason: api.reason || api.last_error || extra.reason,
    live: api.live === true,
    levels_adapted: api.levels_adapted === true,
    auto_executed: api.auto_executed === true,
    ts: Date.now(),
    ...extra,
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
