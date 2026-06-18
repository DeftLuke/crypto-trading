import { config } from '../config/index.js';

const VISION_MODEL = process.env.AI_VISION_MODEL || 'llava:7b';
const MAX_IMAGE_BYTES = 4_000_000;

const CHART_SCAN_SYSTEM = `You analyze crypto chart screenshots (TradingView, Binance, etc.) for market scanning.

Return ONLY valid JSON (no markdown):
{
  "symbol": "BTCUSDT or null if unreadable",
  "timeframe": "e.g. 15m, 1h, 4h",
  "bias": "bullish" | "bearish" | "neutral",
  "summary": "2-4 sentences: trend, momentum, what stands out",
  "structure": "brief notes on structure (BOS, CHoCH, range, OB zones)",
  "levels": {
    "support": [numbers],
    "resistance": [numbers],
    "entry": number or null,
    "stop_loss": number or null,
    "take_profit": [numbers]
  },
  "is_trade_setup": true or false,
  "direction": "LONG" | "SHORT" | null,
  "confidence": 0-100,
  "levels_source": "chart" | "mixed" | "text"
}

Rules:
- Read the ticker/symbol from the chart header or caption — never guess a symbol unless shown.
- Identify visible support/resistance, entry arrows, red/green TP-SL boxes on TradingView.
- is_trade_setup=true only for a clear actionable long/short with entry + stop idea.
- If chart is unclear or not a price chart, set symbol=null and is_trade_setup=false.`;

function parseJsonFromModel(text) {
  if (!text) return null;
  let raw = String(text).trim();
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  }
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

function normalizeChartSymbol(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s || s === 'NULL' || s === 'UNKNOWN') return null;
  return s.endsWith('USDT') ? s : `${s}USDT`;
}

export async function callVisionModel(imageB64, userText) {
  const gateway = config.ai?.gatewayUrl;
  if (!gateway) throw new Error('AI gateway not configured');

  const prompt = `${CHART_SCAN_SYSTEM}\n\nUSER:\n${userText || 'Scan this chart for market structure and any trade setup.'}\n\nAnalyze the attached chart image.`;

  const res = await fetch(`${gateway.replace(/\/$/, '')}/ollama/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.ai?.apiKey ? { 'X-API-Key': config.ai.apiKey } : {}),
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      prompt,
      stream: false,
      images: [imageB64],
      options: { temperature: 0.2, num_predict: 900 },
    }),
    signal: AbortSignal.timeout(120000),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Vision API HTTP ${res.status}`);
  }
  if (data.error) throw new Error(data.error);

  const parsed = parseJsonFromModel(data.response);
  if (!parsed) throw new Error('Could not parse chart analysis from vision model');
  return { parsed, model: VISION_MODEL };
}

/** Download largest Telegram photo (or image document) as base64. */
export async function downloadTelegramImageBase64(telegram, msg) {
  let fileId = null;
  if (msg.photo?.length) {
    fileId = msg.photo[msg.photo.length - 1].file_id;
  } else if (msg.document?.mime_type?.startsWith('image/')) {
    fileId = msg.document.file_id;
  }
  if (!fileId) return null;

  const fileUrl = await telegram.getFileLink(fileId);
  const res = await fetch(String(fileUrl), { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error('Failed to download image from Telegram');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new Error('Image too large (max 4MB). Send a smaller screenshot.');
  }
  return buf.toString('base64');
}

function fmtLevel(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  if (v >= 1000) return v.toFixed(2);
  if (v >= 1) return v.toFixed(4);
  return v.toFixed(6);
}

export function formatChartScanForTelegram(parsed, caption = '') {
  const sym = parsed.symbol || 'Unknown';
  const biasEmoji = parsed.bias === 'bullish' ? '🟢' : parsed.bias === 'bearish' ? '🔴' : '⚪';
  const lines = [
    `<b>📊 Chart Scan — ${sym}</b>`,
    caption ? `<i>${caption.replace(/</g, '')}</i>\n` : '',
    `${biasEmoji} Bias: <b>${String(parsed.bias || 'neutral').toUpperCase()}</b>`,
    parsed.timeframe ? `⏱ Timeframe: ${parsed.timeframe}` : '',
    `🎯 Confidence: ${parsed.confidence ?? '—'}/100`,
    '',
    parsed.summary || 'No summary.',
  ].filter((l) => l !== '');

  if (parsed.structure) {
    lines.push('', `<b>Structure</b>\n${parsed.structure}`);
  }

  const lv = parsed.levels || {};
  const sup = (lv.support || []).slice(0, 3).map(fmtLevel).join(', ');
  const resLv = (lv.resistance || []).slice(0, 3).map(fmtLevel).join(', ');
  if (sup || resLv) {
    lines.push('', '<b>Levels</b>');
    if (sup) lines.push(`Support: <code>${sup}</code>`);
    if (resLv) lines.push(`Resistance: <code>${resLv}</code>`);
  }

  if (parsed.is_trade_setup && lv.entry) {
    const dir = parsed.direction === 'SHORT' ? '🔴 SHORT' : '🟢 LONG';
    lines.push(
      '',
      `<b>Trade setup detected</b> — ${dir}`,
      `Entry: <code>${fmtLevel(lv.entry)}</code>`,
      `SL: <code>${fmtLevel(lv.stop_loss)}</code>`,
    );
    const tps = (lv.take_profit || []).map(fmtLevel).join(' / ');
    if (tps) lines.push(`TP: <code>${tps}</code>`);
    lines.push('\n<i>Use the buttons below to trade this setup.</i>');
  }

  return lines.join('\n');
}

export function chartScanToSignal(parsed, caption = '') {
  if (!parsed?.is_trade_setup || !parsed.symbol) return null;
  const symbol = normalizeChartSymbol(parsed.symbol);
  if (!symbol) return null;

  const lv = parsed.levels || {};
  const entry = Number(lv.entry);
  const sl = Number(lv.stop_loss);
  if (!entry || !sl) return null;

  const tps = (lv.take_profit || []).map(Number).filter((n) => n > 0);
  const direction = parsed.direction === 'SHORT' ? 'SELL' : 'BUY';
  const risk = Math.abs(entry - sl);
  const tp1 = tps[0] || (direction === 'BUY' ? entry + risk : entry - risk);
  const tp2 = tps[1] || (direction === 'BUY' ? entry + risk * 2 : entry - risk * 2);

  return {
    symbol,
    direction,
    confidence: Math.min(100, Math.max(50, Number(parsed.confidence) || 70)),
    entry_price: entry,
    stop_loss: sl,
    tp1,
    tp2,
    tp3: tps[2] || null,
    strategy_name: 'chart-vision',
    source: 'telegram_chart',
    reasons: {
      chart_scan: { status: 'pass', detail: parsed.summary || 'Vision chart scan' },
      levels_source: parsed.levels_source || 'chart',
    },
    mtf_status: { chart: parsed.timeframe || 'unknown' },
    manual_approved: false,
    chart_caption: caption,
  };
}

export async function analyzeTelegramChart(imageB64, caption = '') {
  const userText = caption.trim()
    || 'Scan this chart: identify symbol, trend, key levels, and any trade setup.';
  const { parsed, model } = await callVisionModel(imageB64, userText);
  return {
    parsed,
    model,
    message: formatChartScanForTelegram(parsed, caption),
    signal: chartScanToSignal(parsed, caption),
  };
}
