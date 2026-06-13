import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BacktestChart from './BacktestChart';
import BacktestEquityChart from './BacktestEquityChart';
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

function PairSearch({ pairs, value, onChange }) {
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
        onChange={(e) => {
          setQuery(e.target.value.toUpperCase());
          setOpen(true);
        }}
        onFocus={() => {
          setQuery('');
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
      />
      {open && filtered.length > 0 && (
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
  const [strategies, setStrategies] = useState([]);
  const [pairs, setPairs] = useState([]);
  const [strategyId, setStrategyId] = useState('smc-mtf');
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [timeframe, setTimeframe] = useState('15m');
  const [period, setPeriod] = useState('1y');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState('');
  const [estimate, setEstimate] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const abortRef = useRef(0);
  const autoRunRef = useRef(false);

  useEffect(() => {
    fetchStrategies().then(setStrategies).catch(() => {});
    fetchAllPairs().then((p) => {
      if (Array.isArray(p)) setPairs(p);
    }).catch(() => {});
    fetchBacktestHistory().then(setHistory).catch(() => {});
    autoRunRef.current = true;
  }, []);

  useEffect(() => {
    fetchBacktestEstimate(period, timeframe).then(setEstimate).catch(() => {});
  }, [period, timeframe]);

  const executeBacktest = useCallback(async (sym, strat, tf, per) => {
    const runId = ++abortRef.current;
    setRunning(true);
    setError('');

    try {
      const res = await runBacktest({
        strategyId: strat,
        symbol: sym,
        timeframe: tf,
        period: per,
      });

      if (runId !== abortRef.current) return;
      setResult(res);
      const hist = await fetchBacktestHistory();
      if (runId === abortRef.current) setHistory(hist);
    } catch (err) {
      if (runId === abortRef.current) setError(err.message || 'Backtest failed');
    }

    if (runId === abortRef.current) setRunning(false);
  }, []);

  useEffect(() => {
    if (!autoRunRef.current) return;
    const timer = setTimeout(() => {
      executeBacktest(symbol, strategyId, timeframe, period);
    }, 400);
    return () => clearTimeout(timer);
  }, [symbol, strategyId, timeframe, period, executeBacktest]);

  const handleRun = () => executeBacktest(symbol, strategyId, timeframe, period);

  const selectedStrategy = strategies.find((s) => s.id === strategyId);

  const formatMoney = (v) => {
    if (v == null) return '—';
    return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <div className="strategy-tester-page tv-tester">
      <header className="tester-toolbar">
        <div className="toolbar-group">
          <PairSearch pairs={pairs} value={symbol} onChange={setSymbol} />
        </div>

        <div className="toolbar-group">
          <select className="toolbar-select" value={strategyId} onChange={(e) => setStrategyId(e.target.value)}>
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
            {strategies.length === 0 && <option value="smc-mtf">SMC Multi-Timeframe</option>}
          </select>
        </div>

        <div className="toolbar-group tf-pills">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              type="button"
              className={`tf-pill ${timeframe === tf ? 'active' : ''}`}
              onClick={() => setTimeframe(tf)}
            >
              {tf}
            </button>
          ))}
        </div>

        <div className="toolbar-group period-pills">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`period-pill ${period === p.id ? 'active' : ''}`}
              onClick={() => setPeriod(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="primary-btn toolbar-run"
          onClick={handleRun}
          disabled={running}
        >
          {running ? 'Running…' : 'Run'}
        </button>
      </header>

      {estimate && (
        <div className="tester-estimate">
          ~{estimate.estimatedBars?.toLocaleString()} bars
          {estimate.estimatedSeconds > 30 && ` · est. ${estimate.estimatedSeconds}s`}
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
              {!result && !running && <p className="muted">Select pair and period to backtest.</p>}
              {running && !result && <p className="muted">Analyzing historical data…</p>}

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
                    <div className="metric-row"><dt>Duration</dt><dd>{(result.durationMs / 1000).toFixed(1)}s</dd></div>
                  </dl>

                  {selectedStrategy && (
                    <p className="form-hint" style={{ marginTop: 12 }}>{selectedStrategy.description}</p>
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
                    setStrategyId(h.strategy_id);
                    setTimeframe(h.timeframe || '15m');
                  }}
                >
                  <span>{h.symbol?.replace('USDT', '')}</span>
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
    </div>
  );
}
