/**
 * Python SMC backtest runner — research API or local subprocess.
 * Phase 1: DB candles → Phase 2: SMC → Phase 3: simulation
 */
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '../../..');
const PYTHON_SCRIPT = join(REPO_ROOT, 'research-platform/scripts/run_smc_backtest.py');

const POLL_MS = 400;
const MAX_WAIT_MS = 300000;

function researchBase() {
  return (config.researchApiUrl || process.env.RESEARCH_API_URL || '').replace(/\/$/, '');
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(MAX_WAIT_MS),
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const detail = data.detail || data.error || text || res.statusText;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return data;
}

export async function runPythonBacktest(options, onProgress) {
  const base = researchBase();
  if (base) {
    return runViaResearchApi(base, options, onProgress);
  }
  // No research API — skip subprocess (not available in Docker); caller uses Node worker.
  throw new Error('Python research API not configured');
}

async function runViaResearchApi(base, options, onProgress) {
  onProgress?.(2, 'init', 'Starting Python backtest engine…');

  const start = await fetchJson(`${base}/backtest/smc/run`, {
    method: 'POST',
    body: JSON.stringify({
      symbol: options.symbol,
      timeframe: options.timeframe || options.entryTimeframe || '15m',
      period: options.period || '3m',
      initial_capital: options.initialCapital || 10000,
    }),
  });

  const jobId = start.job_id;
  const deadline = Date.now() + MAX_WAIT_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const st = await fetchJson(`${base}/backtest/smc/status/${jobId}`);
    onProgress?.(
      st.progress_pct || 0,
      st.phase || 'running',
      st.message || 'Running backtest…',
    );
    if (st.status === 'completed' && st.result) return st.result;
    if (st.status === 'failed') throw new Error(st.error || st.message || 'Python backtest failed');
  }
  throw new Error('Python backtest timed out after 5 minutes');
}

function runViaSubprocess(options, onProgress) {
  return new Promise((resolve, reject) => {
    if (!existsSync(PYTHON_SCRIPT)) {
      reject(new Error('Python backtest script not found. Set RESEARCH_API_URL or deploy research-platform.'));
      return;
    }

    const py = process.env.PYTHON_PATH || 'python';
    const args = [
      PYTHON_SCRIPT,
      '--symbol', options.symbol,
      '--timeframe', options.timeframe || options.entryTimeframe || '15m',
      '--period', options.period || '3m',
      '--capital', String(options.initialCapital || 10000),
    ];

    onProgress?.(2, 'init', 'Starting local Python backtest…');

    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const child = spawn(py, args, {
      cwd: join(REPO_ROOT, 'research-platform'),
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.stdout.on('data', (chunk) => {
      for (const line of chunk.toString().split('\n')) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'progress') {
            onProgress?.(msg.progress_pct, msg.phase, msg.message);
          } else if (msg.type === 'result' && msg.ok) {
            finish(() => resolve(msg.data));
          } else if (msg.type === 'error') {
            finish(() => reject(new Error(msg.error || 'Python backtest failed')));
          }
        } catch {
          /* non-json log line */
        }
      }
    });

    child.on('error', (err) => finish(() => reject(err)));
    child.on('close', (code) => {
      if (!settled && code !== 0) {
        finish(() => reject(new Error(stderr.trim() || `Python backtest exited with code ${code}`)));
      }
    });

    setTimeout(() => {
      finish(() => {
        child.kill('SIGTERM');
        reject(new Error('Python backtest timed out'));
      });
    }, MAX_WAIT_MS);
  });
}
