import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BacktestChart from './BacktestChart';
import BacktestEquityChart from './BacktestEquityChart';
import BacktestProgressBar from './BacktestProgressBar';
import FreqtradeControlPanel from './FreqtradeControlPanel';
import {
  fetchStrategies,
  runBacktest,
  fetchBacktestHistory,
  fetchAllPairs,
  fetchBacktestEstimate,
} from '../services/api';

const PERIODS = [
  { id: '1y', label: '1Y' },
  { id: '6m', label: '6M' },
  { id: '3m', label: '3M' },
  { id: '1m', label: '1M' },
  { id: '1w', label: '1W' },
];

const TIMEFRAMES = ['3m', '5m', '15m', '30m', '1h'];

const DEFAULT_STRATEGIES = [
  {
    id: 'smc-mtf',
    name: 'SMC Multi-Timeframe',
    description:
      'Smart Money Concepts with mandatory RSI. BUY when RSI < 30, SHORT when RSI > 70. MTF: 1H → 30M → 15M OB → entry TF.',
    timeframes: ['1h', '30m', '15m', '5m', '3m'],
    engine: 'native',
    backtestInApp: true,
  },
  {
    id: 'freqtrade',
    name: 'Freqtrade (RSI / EMA)',
    description:
      'Python Freqtrade bot — control dry-run/live trading and switch Python strategies from the dashboard.',
    timeframes: ['5m', '15m', '30m', '1h'],
    engine: 'freqtrade',
    backtestInApp: false,
  },
];

function PairSearch({ pairs, value, onChange, disabled }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.toUpperCase();
    if (!q) return pairs.slice(0, 40);
    return pairs.filter((p) => p.includes(q)).slice(0, 40);
  }, [pairs, query]);

  const display = value?.replace('USDT', '') || '';

  return (
    <div className="pair-search">
      <input
        type="text"
        className="pair-search-input"
        value={open ? query : display}
        placeholder="Search pair…"
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value.toUpperCase());
          setOpen(true);
        }}
        onFocus={() => {
          if (disabled) return;
          setQuery('');
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
      />
      {open && !disabled && filtered.length > 0 && (
        <ul className="pair-search-dropdown">
          {filtered.map((p) => (
            <li
              key={p}
              onMouseDown={() => {
                onChange(p);
                setQuery('');
                setOpen(false);
              }}
            >
              {p.replace('USDT', '')}
              <span className="muted">USDT</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function StrategyTesterPage() {
  const [strategies, setStrategies] = useState(DEFAULT_STRATEGIES);
  const [pairs, setPairs] = useState([]);
  const [strategyId, setStrategyId] = useState('smc-mtf');
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [timeframe, setTimeframe] = useState('15m');
  const [period, setPeriod] = useState('1m');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState('');
  const [estimate, setEstimate] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const abortRef = useRef(0);
  const autoRunRef = useRef(false);

  const strategyOptions = useMemo(() => {
    if (!strategies?.length) return DEFAULT_STRATEGIES;
    const ids = new Set(strategies.map((s) => s.id));
    const merged = [...strategies];
    for (const d of DEFAULT_STRATEGIES) {
      if (!ids.has(d.id)) merged.push(d);
    }
    return merged;
  }, [strategies]);

  const selectedStrategy = strategyOptions.find((s) => s.id === strategyId) || strategyOptions[0];
  const isFreqtrade = strategyId === 'freqtrade';

  useEffect(() => {
    fetchStrategies()
      .then((list) => {
        if (Array.isArray(list) && list.length > 0) setStrategies(list);
      })
      .catch(() => {});
    fetchAllPairs().then((p) => {
      if (Array.isArray(p)) setPairs(p);
    }).catch(() => {});
    fetchBacktestHistory().then(setHistory).catch(() => {});
    autoRunRef.current = true;
  }, []);

  useEffect(() => {
    if (isFreqtrade) return;
    fetchBacktestEstimate(period, timeframe).then(setEstimate).catch(() => {});
  }, [period, timeframe, isFreqtrade]);

  const executeBacktest = useCallback(async (sym, strat, tf, per) => {
    const runId = ++abortRef.current;
    setRunning(true);
    setProgress(0);
    setError('');
    setResult(null);

    try {
      const res = await runBacktest({
        strategyId: strat,
        symbol: sym,
        timeframe: tf,
        period: per,
      });

      if (runId !== abortRef.current) return;
      setProgress(100);
      setResult(res);
      const hist = await fetchBacktestHistory();
      if (runId === abortRef.current) setHistory(hist);
    } catch (err) {
      if (runId === abortRef.current) {
        const msg = err.message || 'Backtest failed';
        setError(
          msg === 'Failed to fetch'
            ? 'Server timed out or restarted during backtest. Try 3M period or click Run again.'
            : msg
        );
      }
    }

    if (runId === abortRef.current) {
      setRunning(false);
      setTimeout(() => setProgress(0), 600);
    }
  }, []);

  useEffect(() => {
    if (!autoRunRef.current || isFreqtrade) return;
    const shortPeriods = ['1w', '1m', '3m'];
    if (!shortPeriods.includes(period)) return;

    const timer = setTimeout(() => {
      executeBacktest(symbol, strategyId, timeframe, period);
    }, 400);
    return () => clearTimeout(timer);
  }, [symbol, strategyId, timeframe, period, executeBacktest, isFreqtrade]);

  const handleRun = () => executeBacktest(symbol, strategyId, timeframe, period);

  const controlsDisabled = running;

  const formatMoney = (v) => {
    if (v == null) return '—';
    return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <div className="strategy-tester-page tv-tester">
      <header className="tester-toolbar">
        <div className="toolbar-row">
          <div className="toolbar-field toolbar-field-strategy">
            <span className="toolbar-label">Strategy</span>
            <select
              className="toolbar-select strategy-select"
              value={strategyId}
              disabled={controlsDisabled}
              onChange={(e) => setStrategyId(e.target.value)}
            >
              {strategyOptions.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {!isFreqtrade && (
          <>
          <div className="toolbar-field">
            <span className="toolbar-label">Pair</span>
            <PairSearch
              pairs={pairs}
              value={symbol}
              onChange={setSymbol}
              disabled={controlsDisabled}
            />
          </div>

          <div className="toolbar-field">
            <span className="toolbar-label">Entry TF</span>
            <div className="toolbar-group tf-pills">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  type="button"
                  className={`tf-pill ${timeframe === tf ? 'active' : ''}`}
                  disabled={controlsDisabled}
                  onClick={() => setTimeframe(tf)}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          <div className="toolbar-field">
            <span className="toolbar-label">Period</span>
            <div className="toolbar-group period-pills">
              {PERIODS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`period-pill ${period === p.id ? 'active' : ''}`}
                  disabled={controlsDisabled}
                  onClick={() => setPeriod(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            className="primary-btn toolbar-run"
            onClick={handleRun}
            disabled={running}
          >
            {running ? `Running ${progress}%` : 'Run backtest'}
          </button>
          </>
          )}
        </div>

        {selectedStrategy?.description && (
          <p className="toolbar-strategy-desc">{selectedStrategy.description}</p>
        )}
      </header>

      {isFreqtrade ? (
        <div className="freqtrade-tester-wrap">
          <div className="tester-hint">
            Freqtrade backtests run on the server via CLI. Use <strong>Strategy Control</strong> to
            start/stop the bot, switch Python strategies, and force-exit trades.
          </div>
          <FreqtradeControlPanel />
          <section className="freqtrade-card">
            <h2>CLI backtest (on Kali/VPS)</h2>
            <pre className="cli-block">{`docker compose --profile freqtrade run --rm freqtrade backtesting \\
  --config user_data/config.json \\
  --strategy TradeGPT_RSI_Momentum \\
  --timerange 20260301-`}</pre>
          </section>
        </div>
      ) : (
        <>
      <BacktestProgressBar
        running={running}
        estimate={estimate}
        progress={progress}
        onProgress={setProgress}
      />

      {!running && (period === '3m' || period === '6m') && (timeframe === '5m' || timeframe === '3m') && (
        <div className="tester-estimate tester-hint">
          For <strong>3M+</strong> periods, switch entry TF to <strong>15m</strong> or <strong>30m</strong>. 5m entry is only reliable for 1W–1M.
        </div>
      )}

      {!running && period === '1y' && (
        <div className="tester-estimate tester-hint">
          1Y backtests take 30–90 seconds. Click <strong>Run backtest</strong> — progress bar will show status.
        </div>
      )}

      {error && <div className="tester-error">{error}</div>}

      <div className="tester-main">
        <div className="tester-chart-panel">
          <BacktestChart
            candles={result?.chartCandles}
            trades={result?.trades}
            symbol={symbol}
            loading={running}
          />
          {result?.equityCurve && (
            <BacktestEquityChart
              equityCurve={result.equityCurve}
              initialCapital={result.initialCapital}
            />
          )}
        </div>

        <aside className="tester-results-panel">
          <div className="results-tabs">
            {['overview', 'trades', 'history'].map((tab) => (
              <button
                key={tab}
                type="button"
                className={`results-tab ${activeTab === tab ? 'active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab === 'overview' ? 'Overview' : tab === 'trades' ? 'List of Trades' : 'History'}
              </button>
            ))}
          </div>

          {activeTab === 'overview' && (
            <div className="results-overview">
              {!result && !running && (
                <p className="muted">
                  Choose <strong>Pair</strong>, <strong>Strategy</strong>, timeframe and period, then Run.
                </p>
              )}
              {running && !result && (
                <div className="overview-running">
                  <p className="muted">Backtest in progress…</p>
                  <div className="mini-progress-track">
                    <div className="mini-progress-fill" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="muted">{progress}% — {selectedStrategy?.name}</p>
                </div>
              )}

              {result && (
                <>
                  <div className="overview-hero">
                    <span className={`overview-pnl ${result.netProfit >= 0 ? 'green-text' : 'red-text'}`}>
                      {result.netProfit >= 0 ? '+' : ''}{formatMoney(result.netProfit)} USDT
                    </span>
                    <span className="overview-pnl-pct">
                      {result.netProfitPercent >= 0 ? '+' : ''}{result.netProfitPercent?.toFixed(2)}%
                    </span>
                  </div>

                  <dl className="metrics-list">
                    <div className="metric-row"><dt>Strategy</dt><dd>{selectedStrategy?.name}</dd></div>
                    <div className="metric-row"><dt>Total trades</dt><dd>{result.totalTrades}</dd></div>
                    <div className="metric-row"><dt>Win rate</dt><dd>{result.winRate?.toFixed(1)}%</dd></div>
                    <div className="metric-row"><dt>Profit factor</dt><dd>{result.profitFactor?.toFixed(2)}</dd></div>
                    <div className="metric-row"><dt>Max drawdown</dt><dd className="red-text">{result.maxDrawdownPercent?.toFixed(2)}%</dd></div>
                    <div className="metric-row"><dt>Avg winning trade</dt><dd className="green-text">{formatMoney(result.avgWin)}</dd></div>
                    <div className="metric-row"><dt>Avg losing trade</dt><dd className="red-text">{formatMoney(result.avgLoss)}</dd></div>
                    <div className="metric-row"><dt>Best trade</dt><dd className="green-text">{formatMoney(result.largestWin)}</dd></div>
                    <div className="metric-row"><dt>Worst trade</dt><dd className="red-text">{formatMoney(result.largestLoss)}</dd></div>
                    <div className="metric-row"><dt>Max consec. wins</dt><dd>{result.maxConsecutiveWins}</dd></div>
                    <div className="metric-row"><dt>Max consec. losses</dt><dd>{result.maxConsecutiveLosses}</dd></div>
                    <div className="metric-row"><dt>Avg R multiple</dt><dd>{result.avgRMultiple?.toFixed(2)}</dd></div>
                    <div className="metric-row"><dt>Bars analyzed</dt><dd>{result.barsAnalyzed?.toLocaleString()}</dd></div>
                    {result.durationMs != null && (
                      <div className="metric-row"><dt>Duration</dt><dd>{(result.durationMs / 1000).toFixed(1)}s</dd></div>
                    )}
                  </dl>
                  {result.totalTrades === 0 && (
                    <p className="tester-hint muted">
                      No trades matched all rules in this window (1h/30m/15m alignment + OB retest + RSI &lt; 30 buy / &gt; 70 short).
                      Try <strong>1M</strong> or <strong>3M</strong> period, or switch entry TF to <strong>15m</strong>.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === 'trades' && (
            <div className="results-trades-list">
              {!result?.trades?.length && <p className="muted">No trades in this run.</p>}
              {result?.trades?.map((t, i) => (
                <div key={i} className={`trade-row ${t.outcome}`}>
                  <div className="trade-row-head">
                    <span className={t.direction === 'BUY' ? 'green-text' : 'red-text'}>
                      {t.direction === 'BUY' ? 'LONG' : 'SHORT'}
                    </span>
                    <span className={t.outcome === 'win' ? 'green-text' : 'red-text'}>{t.outcome}</span>
                    <span>{t.rMultiple?.toFixed(2)}R</span>
                  </div>
                  <div className="trade-row-detail">
                    <span>Entry {t.entry?.toFixed(4)}</span>
                    <span>Exit {t.exit?.toFixed(4)}</span>
                  </div>
                  <div className="trade-row-date muted">
                    {new Date(t.entryDate).toLocaleString()} → {new Date(t.exitDate).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'history' && (
            <div className="results-history">
              {history.length === 0 && <p className="muted">No saved backtests yet.</p>}
              {history.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  className="history-row"
                  onClick={() => {
                    setSymbol(h.symbol);
                    setStrategyId(h.strategy_id || 'smc-mtf');
                    setTimeframe(h.timeframe || '15m');
                  }}
                >
                  <span>{h.symbol?.replace('USDT', '')}</span>
                  <span>{h.strategy_id}</span>
                  <span>{h.timeframe}</span>
                  <span>{h.total_trades} trades</span>
                  <span className={parseFloat(h.total_pnl) >= 0 ? 'green-text' : 'red-text'}>
                    {parseFloat(h.total_pnl || 0).toFixed(2)}
                  </span>
                  <span className="muted">{new Date(h.created_at).toLocaleDateString()}</span>
                </button>
              ))}
            </div>
          )}
        </aside>
      </div>
        </>
      )}
    </div>
  );
}
