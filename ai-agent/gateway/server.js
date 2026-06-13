/**
 * AI Agent Gateway — Kali :8080
 * Public: https://ai.deftluke.online (Ollama access via this domain only)
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.AI_GATEWAY_PORT || 8080;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'mistral:7b';
const OLLAMA_FALLBACK = process.env.OLLAMA_FALLBACK || 'mistral:7b';
const API_KEY = process.env.AI_API_KEY || '';
const BACKEND_URL = process.env.BACKEND_URL || 'https://api.deftluke.online';

let systemPrompt = 'You are a crypto trading AI assistant. Answer from context only.';

try {
  systemPrompt = fs.readFileSync(path.join(__dirname, 'prompts/trading-assistant.txt'), 'utf8');
} catch {
  /* use default */
}

const app = express();
app.use(express.json({ limit: '1mb' }));

function auth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.key;
  if (API_KEY && key !== API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
}

async function proxyOllama(path, options = {}) {
  const res = await fetch(`${OLLAMA_URL}${path}`, {
    ...options,
    signal: AbortSignal.timeout(options.timeout || 120000),
  });
  return res.json();
}

async function ollamaChat(prompt, system) {
  const models = [OLLAMA_MODEL, OLLAMA_FALLBACK].filter(Boolean);
  for (const model of models) {
    try {
      const data = await proxyOllama('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt: system ? `${system}\n\n${prompt}` : prompt,
          stream: false,
          options: { temperature: 0.3, num_predict: 600 },
        }),
      });
      if (data.error) throw new Error(data.error);
      return { answer: data.response?.trim(), model };
    } catch (err) {
      console.warn(`[Gateway] ${model} failed:`, err.message);
    }
  }
  throw new Error('All models failed');
}

app.get('/health', async (req, res) => {
  try {
    const data = await proxyOllama('/api/tags', { timeout: 5000 });
    res.json({
      status: 'ok',
      service: 'ai-agent-gateway',
      publicUrl: 'https://ai.deftluke.online',
      backendUrl: BACKEND_URL,
      models: (data.models || []).map((m) => m.name).slice(0, 8),
    });
  } catch (err) {
    res.status(503).json({ status: 'error', error: err.message });
  }
});

app.get('/ollama/tags', auth, async (req, res) => {
  try {
    res.json(await proxyOllama('/api/tags', { timeout: 10000 }));
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

app.post('/ollama/generate', auth, async (req, res) => {
  try {
    const data = await proxyOllama('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/ollama/embeddings', auth, async (req, res) => {
  try {
    const data = await proxyOllama('/api/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html><head><title>AI Trading Agent</title>
<style>body{font-family:system-ui;background:#0d1117;color:#e6edf3;padding:40px;max-width:640px;margin:0 auto}
h1{color:#58a6ff}.ok{color:#3fb950}code{background:#1c2333;padding:2px 8px;border-radius:4px}
a{color:#58a6ff}</style></head>
<body>
<h1>AI Trading Agent</h1>
<p class="ok">Online — https://ai.deftluke.online</p>
<h3>Public endpoints</h3>
<ul>
<li><a href="/health">GET /health</a></li>
<li><code>POST /chat</code> — Q&amp;A (X-API-Key)</li>
<li><code>POST /lesson</code> — trade lessons (X-API-Key)</li>
<li><code>GET /ollama/tags</code> — model list (X-API-Key)</li>
<li><code>POST /ollama/generate</code> — Ollama proxy (X-API-Key)</li>
<li><code>POST /ollama/embeddings</code> — embeddings proxy (X-API-Key)</li>
</ul>
<p>Backend: <a href="https://api.deftluke.online/health">api.deftluke.online</a></p>
<p>Model: <code>${OLLAMA_MODEL}</code></p>
</body></html>`);
});

app.post('/chat', auth, async (req, res) => {
  try {
    const { question, context } = req.body;
    if (!question) return res.status(400).json({ error: 'question required' });

    let ctx = context;
    if (!ctx && BACKEND_URL) {
      try {
        const r = await fetch(`${BACKEND_URL}/api/ai/context`, { signal: AbortSignal.timeout(10000) });
        ctx = await r.json();
      } catch { /* no backend */ }
    }

    const prompt = `CONTEXT:\n${JSON.stringify(ctx || {}, null, 2)}\n\nQUESTION: ${question}`;
    const { answer, model } = await ollamaChat(prompt, systemPrompt);
    res.json({ answer, model, source: 'ai-gateway' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/lesson', auth, async (req, res) => {
  try {
    const { signal, outcome, lessonType } = req.body;
    const prompt = `Write a trading lesson (3-5 bullets) for a ${lessonType} ${signal?.direction} on ${signal?.symbol}.
Outcome: ${outcome}. Entry: ${signal?.entry_price}, SL: ${signal?.stop_loss}.
Data: ${JSON.stringify(signal?.reasons || {})}`;
    const { answer, model } = await ollamaChat(prompt, systemPrompt);
    res.json({ lesson: answer, model });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`AI Agent Gateway on port ${PORT} → https://ai.deftluke.online`);
  console.log(`Backend: ${BACKEND_URL} | Ollama: ${OLLAMA_URL}`);
});
