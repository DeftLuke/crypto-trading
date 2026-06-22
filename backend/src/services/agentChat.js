/**
 * Dashboard / research-fallback agent chat — powered by OpenClaw (text) with trading context.
 */
import { randomUUID } from 'crypto';
import { askTradingAgent } from './aiAgent.js';
import { checkOpenClawHealth, isOpenClawConfigured } from './openclaw.js';

export async function handleAgentChat(body = {}) {
  const message = String(body.message || body.question || '').trim();
  if (!message) throw new Error('message required');

  const conversationId = body.conversation_id || body.conversationId || `dash-${randomUUID()}`;
  const result = await askTradingAgent(message, {
    conversationId,
    channel: body.channel || 'dashboard',
  });

  return {
    conversation_id: conversationId,
    answer: result.answer,
    model: result.model,
    intent: 'question',
    agent: 'coordinator',
    tool_calls: [],
    memories_used: [],
    suggestions: suggestFollowUps(message),
    source: result.source,
  };
}

function suggestFollowUps(message) {
  const msg = message.toLowerCase();
  const out = [];
  if (/strategy|backtest|win rate|pf/.test(msg)) out.push('Compare top strategies by profit factor');
  if (/risk|exposure|drawdown/.test(msg)) out.push('Show current open exposure and margin');
  if (/trade|position|open/.test(msg)) out.push('Summarize open positions and protection status');
  if (out.length === 0) out.push('Explain the SMC-MTF entry rules for the next signal');
  return out.slice(0, 3);
}

export async function operationsDashboardPayload() {
  const openclaw = await checkOpenClawHealth();
  return {
    status: {
      llm_configured: openclaw.ok || isOpenClawConfigured(),
      openclaw_configured: isOpenClawConfigured(),
      openclaw_ok: openclaw.ok,
      openclaw_models: openclaw.models || [],
      n8n_configured: Boolean(process.env.N8N_BASE_URL),
      conversations: 0,
      actions: 0,
      active_tasks: 0,
    },
    recent_actions: [],
    active_tasks: [],
    recent_reports: [],
    workflows: [],
    notifications: [],
    tools: [
      { name: 'search_trades', description: 'Recent trades and PnL' },
      { name: 'search_strategies', description: 'Strategy catalog and backtests' },
      { name: 'get_risk_status', description: 'Exposure and open positions' },
      { name: 'system_health', description: 'Backend and exchange health' },
    ],
    openclaw,
  };
}
