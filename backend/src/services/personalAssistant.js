import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';
import { ollamaGenerate } from './ollama.js';
import { get24hrTicker } from './binance.js';
import { getPairStats, getSignals } from './supabase.js';
import { getMTFBias, formatMTFBias } from '../strategy/mtfAnalysis.js';
import { webSearch, formatSearchResults } from './webSearch.js';
import { rebootBackend, getSystemStatus, formatSystemStatus } from './agentActions.js';
import {
  getChatHistory,
  saveChatMessage,
  getMemories,
  saveMemory,
  getActiveTasks,
  createTask,
  cancelWatchTask,
} from './agentMemory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SYMBOL_ALIASES = {
  btc: 'BTCUSDT', bitcoin: 'BTCUSDT', eth: 'ETHUSDT', ethereum: 'ETHUSDT',
  sol: 'SOLUSDT', bnb: 'BNBUSDT', xrp: 'XRPUSDT', doge: 'DOGEUSDT',
  atom: 'ATOMUSDT', ada: 'ADAUSDT', avax: 'AVAXUSDT', link: 'LINKUSDT',
  dot: 'DOTUSDT', matic: 'MATICUSDT', ltc: 'LTCUSDT', uni: 'UNIUSDT',
  near: 'NEARUSDT', apt: 'APTUSDT', arb: 'ARBUSDT', op: 'OPUSDT', fil: 'FILUSDT',
};

function loadPersonalPrompt() {
  const paths = [
    path.join(__dirname, '../../../ai-agent/prompts/personal-assistant.txt'),
    path.join(__dirname, '../../ai-agent/prompts/personal-assistant.txt'),
  ];
  for (const p of paths) {
    try { return fs.readFileSync(p, 'utf8'); } catch { /* next */ }
  }
  return 'You are TradeGPT. Reply briefly — answer ONLY what was asked.';
}

export function normalizeSymbol(text) {
  const lower = text.toLowerCase().trim();
  if (SYMBOL_ALIASES[lower]) return SYMBOL_ALIASES[lower];
  const upper = text.toUpperCase().replace(/[^A-Z]/g, '');
  if (upper.endsWith('USDT')) return upper;
  if (upper.length >= 2 && upper.length <= 10) return `${upper}USDT`;
  return null;
}

export function extractSymbolsFromText(text) {
  const found = new Set();
  for (const [alias, sym] of Object.entries(SYMBOL_ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`, 'i').test(text)) found.add(sym);
  }
  const usdtMatch = text.match(/\b([A-Z]{2,10})USDT\b/i);
  if (usdtMatch) found.add(usdtMatch[0].toUpperCase());
  return [...found];
}

function classifyIntent(text) {
  const t = text.trim().toLowerCase();
  if (/^(hi|hello|hey|yo|salam|good morning|good evening)[\s!.?]*$/.test(t)) return 'greeting';
  if (/reboot|restart|reload/.test(t) && /app|application|bot|system|trading|server/.test(t)) return 'reboot';
  if (/^(status|system status|are you online|health check)/.test(t)) return 'status';
  if (/^(search|google|look up|find on web)/.test(t) || /search (?:for|about|on)/.test(t)) return 'web_search';
  if (/^remember|^what do you remember|^my memories|^show memories/.test(t)) return 'memory';
  if (/watch|unwatch|stop watching|my watchlist/.test(t)) return 'watch';
  if (/timer|remind me|alert me in/.test(t)) return 'timer';
  if (/bullish|bearish|trend|structure|mtf|multi.?timeframe|bos|choch/.test(t)) return 'mtf';
  if (/tell me about|how is|what about|info on|analysis|price|how much/.test(t)) return 'coin_data';
  if (/show.*data|give me.*data|full stats|my stats|win rate|portfolio/.test(t)) return 'data';
  if (extractSymbolsFromText(text).length) return 'coin_chat';
  return 'general';
}

async function getSymbolFocus(symbol, includeStats = true) {
  try {
    const [ticker, pairRes, sigRes] = await Promise.all([
      get24hrTicker(symbol),
      includeStats ? getPairStats() : Promise.resolve({ data: [] }),
      includeStats ? getSignals(10) : Promise.resolve({ data: [] }),
    ]);
    const stats = (pairRes.data || []).find((p) => p.symbol === symbol);
    const coinSignals = (sigRes.data || []).filter((s) => s.symbol === symbol).slice(0, 2);
    return {
      symbol,
      price: parseFloat(ticker.lastPrice),
      change24h: parseFloat(ticker.priceChangePercent),
      high24h: parseFloat(ticker.highPrice),
      low24h: parseFloat(ticker.lowPrice),
      yourStats: stats ? {
        win_rate: stats.win_rate,
        strategy_score: stats.strategy_score,
        total_trades: stats.total_trades,
      } : null,
      recentSignals: coinSignals.map((s) => `${s.direction} ${s.confidence}%`),
    };
  } catch (err) {
    return { symbol, error: err.message };
  }
}

function formatCoinBrief(focus) {
  if (focus.error) return `Couldn't fetch ${focus.symbol} right now.`;
  let msg = `<b>${focus.symbol.replace('USDT', '')}</b> $${focus.price?.toLocaleString()} (${focus.change24h >= 0 ? '+' : ''}${focus.change24h?.toFixed(2)}% 24h)`;
  return msg;
}

function formatCoinFull(focus) {
  if (focus.error) return `Couldn't fetch ${focus.symbol} right now.`;
  let msg = `📊 <b>${focus.symbol}</b>\n`;
  msg += `Price: $${focus.price}\n24h: ${focus.change24h?.toFixed(2)}%\nHigh: $${focus.high24h} | Low: $${focus.low24h}\n`;
  if (focus.yourStats) {
    msg += `\nYour stats: WR ${focus.yourStats.win_rate}% | Score ${focus.yourStats.strategy_score} | ${focus.yourStats.total_trades} trades`;
  }
  if (focus.recentSignals?.length) {
    msg += `\nSignals: ${focus.recentSignals.join(', ')}`;
  }
  return msg;
}

/** Built-in handlers — no AI dump. */
export async function tryQuickActions(chatId, text) {
  const t = text.trim();
  const intent = classifyIntent(t);

  if (intent === 'greeting') {
    return 'Hello! 👋 How can I help? Ask about any coin, trend, or give me a task.';
  }

  if (intent === 'reboot') {
    if (String(chatId) !== String(config.telegram.chatId)) {
      return 'Only the owner can reboot the application.';
    }
    return rebootBackend(chatId);
  }

  if (intent === 'status') {
    return formatSystemStatus(await getSystemStatus());
  }

  if (intent === 'web_search') {
    const q = t.replace(/^(search(?: for| about| on web| google)?|look up|google|find on web)\s*/i, '').trim() || t;
    const results = await webSearch(q);
    return formatSearchResults(results);
  }

  const remember = t.match(/^remember(?:\s+that)?\s+(.+)/i);
  if (remember) {
    await saveMemory(chatId, remember[1].trim(), 'fact');
    return `✅ Remembered: "${remember[1].trim()}"`;
  }

  if (/^what do you remember|^my memories|^show memories/i.test(t)) {
    const mem = await getMemories(chatId, 15);
    if (!mem.length) return 'No saved memories yet. Say "remember that …"';
    return '🧠 Memories:\n' + mem.map((m) => `• ${m.content}`).join('\n');
  }

  const watch = t.match(/(?:watch|keep (?:an )?eye on|monitor|look(?:ing)? at)\s+(\w+)/i);
  if (watch) {
    const symbol = normalizeSymbol(watch[1]);
    if (!symbol) return 'Which coin? e.g. "watch BTC"';
    await createTask(chatId, 'watch_coin', { symbol, note: t });
    return `👁 Watching ${symbol} for signals.`;
  }

  const stopWatch = t.match(/(?:stop watching|unwatch|don't watch)\s+(\w+)/i);
  if (stopWatch) {
    const symbol = normalizeSymbol(stopWatch[1]);
    if (!symbol) return 'Which coin to unwatch?';
    await cancelWatchTask(chatId, symbol);
    return `Stopped watching ${symbol}.`;
  }

  if (/^my watchlist|^what am i watching/i.test(t)) {
    const tasks = (await getActiveTasks(chatId)).filter((x) => x.task_type === 'watch_coin');
    if (!tasks.length) return 'Watchlist empty. Say "watch BTC".';
    return '👁 Watching:\n' + tasks.map((x) => `• ${x.payload.symbol}`).join('\n');
  }

  const timer = t.match(/(?:timer|remind me(?: in)?|alert me(?: in)?)\s+(\d+)\s*(min(?:ute)?s?|hours?|hrs?|sec(?:ond)?s?)?(?:\s+(?:about|to|for)\s+(.+))?/i);
  if (timer) {
    const n = parseInt(timer[1], 10);
    const unit = (timer[2] || 'min').toLowerCase();
    let ms = n * 60_000;
    if (unit.startsWith('hour') || unit.startsWith('hr')) ms = n * 3_600_000;
    if (unit.startsWith('sec')) ms = n * 1000;
    const note = timer[3]?.trim() || t.replace(/^(timer|remind me(?: in)?|alert me(?: in)?)\s+\d+\s*\w*\s*/i, '').trim() || 'Reminder';
    await createTask(chatId, 'timer', { note, minutes: n, unit }, new Date(Date.now() + ms).toISOString());
    return `⏰ Set for ${n} ${unit.replace(/s$/, '')}(s): "${note}"`;
  }

  // MTF / structure — data only when asked
  if (intent === 'mtf') {
    const symbols = extractSymbolsFromText(t);
    const sym = symbols[0] || normalizeSymbol(t.replace(/.*\b(on|for|of)\b\s+/i, '').split(/\s+/).pop()) || 'BTCUSDT';
    const bias = await getMTFBias(sym);
    return formatMTFBias(bias);
  }

  // Coin price — brief by default
  const priceMatch = t.match(/(?:price of|how much is|what is|what's)\s+(\w+)/i)
    || t.match(/\b(\w+)\s+price\b/i);
  if (priceMatch || intent === 'coin_data') {
    const word = priceMatch?.[1] || t.match(/(?:about|on|for)\s+(\w+)/i)?.[1] || extractSymbolsFromText(t)[0]?.replace('USDT', '') || 'btc';
    const symbol = normalizeSymbol(word);
    if (!symbol) return 'Which coin? e.g. BTC, ETH, SOL';
    const wantsFull = /full|detail|data|stats|analysis|everything/.test(t);
    const focus = await getSymbolFocus(symbol, wantsFull);
    if (wantsFull) return formatCoinFull(focus);
    return formatCoinBrief(focus);
  }

  if (intent === 'data') {
    const symbols = extractSymbolsFromText(t);
    if (symbols.length) {
      const focus = await getSymbolFocus(symbols[0], true);
      return formatCoinFull(focus);
    }
    const { data: stats } = await getPairStats();
    const top = (stats || []).slice(0, 8).map((p) =>
      `${p.symbol}: WR ${parseFloat(p.win_rate || 0).toFixed(0)}% | Score ${parseFloat(p.strategy_score).toFixed(0)}`
    );
    return '📊 Top pairs:\n' + (top.join('\n') || 'No data yet');
  }

  return null;
}

async function buildMinimalContext(chatId, question, intent) {
  const base = {
    memories: (await getMemories(chatId, 5)).map((m) => m.content),
    recentChat: (await getChatHistory(chatId, 4)).map((m) => ({ role: m.role, content: m.content.slice(0, 200) })),
  };

  const symbols = extractSymbolsFromText(question);
  if (symbols.length && ['coin_chat', 'general', 'mtf'].includes(intent)) {
    base.symbol = await getSymbolFocus(symbols[0], false);
    if (/trend|structure|bullish|bearish|bos/.test(question)) {
      base.mtf = await getMTFBias(symbols[0]);
    }
  }

  if (/trade|lesson|signal|win|loss/.test(question)) {
    const { data: signals } = await getSignals(3);
    base.recentSignals = (signals || []).map((s) => `${s.symbol} ${s.direction} ${s.confidence}%`);
  }

  return base;
}

function trimReply(text, maxLen = 600) {
  const clean = text.replace(/```[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 3) + '…';
}

export async function askPersonalAssistant(chatId, question) {
  const intent = classifyIntent(question);
  const quick = await tryQuickActions(chatId, question);
  if (quick) {
    await saveChatMessage(chatId, 'user', question);
    await saveChatMessage(chatId, 'assistant', quick);
    return { answer: quick, source: 'action', model: 'builtin' };
  }

  const context = await buildMinimalContext(chatId, question, intent);
  const systemPrompt = loadPersonalPrompt();
  const wantsDetail = /detail|full|explain|data|stats|analysis|breakdown/.test(question);

  const prompt = `Context (use only if relevant):
${JSON.stringify(context)}

User: ${question}

Rules: Answer ONLY what they asked. ${wantsDetail ? 'They want detail — use bullets.' : 'Keep it SHORT (1-3 sentences max).'} No JSON dumps. No listing all pairs unless asked.`;

  await saveChatMessage(chatId, 'user', question);

  const gatewayUrl = config.ai?.gatewayUrl;
  try {
    if (gatewayUrl) {
      const res = await fetch(`${gatewayUrl}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.ai?.apiKey ? { 'X-API-Key': config.ai.apiKey } : {}),
        },
        body: JSON.stringify({ question, context, systemPrompt }),
        signal: AbortSignal.timeout(120000),
      });
      if (res.ok) {
        const data = await res.json();
        const answer = trimReply(data.answer, wantsDetail ? 1200 : 500);
        await saveChatMessage(chatId, 'assistant', answer);
        return { answer, model: data.model, source: 'gateway' };
      }
    }
  } catch (err) {
    console.warn('[PersonalAssistant] Gateway:', err.message);
  }

  const { text, model } = await ollamaGenerate(prompt, systemPrompt);
  const answer = trimReply(text, wantsDetail ? 1200 : 500);
  await saveChatMessage(chatId, 'assistant', answer);
  return { answer, model, source: 'ollama' };
}

export async function buildPersonalContext(chatId, userMessage) {
  return buildMinimalContext(chatId, userMessage, classifyIntent(userMessage));
}
