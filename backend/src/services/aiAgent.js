import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';
import { ollamaGenerate } from './ollama.js';
import {
  getPairStats,
  getTrades,
  getTradeLessons,
  getLessonStats,
  getSignals,
} from './supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadSystemPrompt() {
  const paths = [
    path.join(__dirname, '../../../ai-agent/prompts/trading-assistant.txt'),
    path.join(__dirname, '../../ai-agent/prompts/trading-assistant.txt'),
  ];
  for (const p of paths) {
    try {
      return fs.readFileSync(p, 'utf8');
    } catch { /* try next */ }
  }
  return `You are a crypto trading assistant for SMC futures trading.
Answer ONLY from provided data. Use bullet points. Max 400 words for Telegram.`;
}

export async function buildTradingContext() {
  const [
    { data: pairStats },
    { data: trades },
    { data: winLessons },
    { data: lossLessons },
    { data: skippedLessons },
    { data: recentSignals },
    lessonStats,
  ] = await Promise.all([
    getPairStats(),
    getTrades(10),
    getTradeLessons('executed', 10),
    getTradeLessons('executed', 20),
    getTradeLessons('skipped', 10),
    getSignals(5),
    getLessonStats(),
  ]);

  const wins = (winLessons || []).filter((l) => l.outcome === 'win').slice(0, 5);
  const losses = (lossLessons || []).filter((l) => l.outcome === 'loss').slice(0, 5);

  return {
    pairStats: (pairStats || []).slice(0, 15).map((p) => ({
      symbol: p.symbol,
      win_rate: p.win_rate,
      strategy_score: p.strategy_score,
      total_trades: p.total_trades,
    })),
    recentTrades: (trades || []).slice(0, 8).map((t) => ({
      symbol: t.symbol,
      direction: t.direction,
      pnl: t.pnl,
      r_multiple: t.r_multiple,
      status: t.status,
      close_reason: t.close_reason,
    })),
    winningLessons: wins.map((l) => ({
      symbol: l.symbol,
      lesson: l.lesson_text?.slice(0, 200),
      win_probability: l.win_probability,
    })),
    losingLessons: losses.map((l) => ({
      symbol: l.symbol,
      lesson: l.lesson_text?.slice(0, 200),
    })),
    skippedLessons: (skippedLessons || []).slice(0, 5).map((l) => ({
      symbol: l.symbol,
      outcome: l.outcome,
      lesson: l.lesson_text?.slice(0, 200),
    })),
    recentSignals: (recentSignals || []).slice(0, 3).map((s) => ({
      symbol: s.symbol,
      direction: s.direction,
      confidence: s.confidence,
      final_outcome: s.final_outcome,
      user_action: s.user_action,
    })),
    stats: lessonStats,
  };
}

export async function askTradingAgent(question, options = {}) {
  const context = options.context || await buildTradingContext();
  const systemPrompt = await loadSystemPrompt();

  const prompt = `TRADING DATA CONTEXT:
${JSON.stringify(context, null, 2)}

USER QUESTION: ${question}

Answer using ONLY the data above. Include win/loss/skip lessons when relevant.`;

  // Try AI gateway first (subdomain or Tailscale), then direct Ollama
  const gatewayUrl = config.ai?.gatewayUrl;

  if (gatewayUrl && !options.forceOllama) {
    try {
      const res = await fetch(`${gatewayUrl}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.ai?.apiKey ? { 'X-API-Key': config.ai.apiKey } : {}),
        },
        body: JSON.stringify({ question, context }),
        signal: AbortSignal.timeout(120000),
      });
      if (res.ok) {
        const data = await res.json();
        return { answer: data.answer, model: data.model, source: 'gateway' };
      }
    } catch (err) {
      console.warn('[AI Agent] Gateway unavailable, using direct Ollama:', err.message);
    }
  }

  const { text, model } = await ollamaGenerate(prompt, systemPrompt);
  return { answer: text, model, source: 'ollama' };
}

export async function getLessonsSummary(type = 'all') {
  const context = await buildTradingContext();

  const summaries = {
    wins: context.winningLessons,
    losses: context.losingLessons,
    skipped: context.skippedLessons,
    stats: context.stats,
  };

  if (type === 'wins') return formatLessonsReply('Winning Lessons', summaries.wins, summaries.stats?.executed);
  if (type === 'losses') return formatLessonsReply('Losing Lessons', summaries.losses, summaries.stats?.executed);
  if (type === 'skipped') return formatLessonsReply('Skipped Trade Lessons', summaries.skipped, summaries.stats?.skipped);

  return summaries;
}

function formatLessonsReply(title, lessons, stats) {
  if (!lessons?.length) {
    return `${title}: No lessons recorded yet. Trade or skip signals — outcomes are checked at 15/20 min.`;
  }

  let msg = `📚 ${title}\n\n`;
  if (stats) {
    msg += `Stats: ${stats.wins}W / ${stats.losses}L (${stats.total} total)\n\n`;
  }
  for (const l of lessons.slice(0, 3)) {
    msg += `• ${l.symbol}: ${l.lesson || l.outcome || '—'}\n\n`;
  }
  return msg.trim();
}
