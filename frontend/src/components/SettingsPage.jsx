import { useEffect, useState } from 'react';
import {
  fetchApiKeyStatus,
  saveApiKeys,
  setTradingMode,
  testApiKeys,
} from '../services/api';
import { loadTvConfig, saveTvConfig } from '../utils/tvConfig';

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [keyMode, setKeyMode] = useState('demo');
  const [tradingMode, setTradingModeState] = useState('demo');
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [switchingMode, setSwitchingMode] = useState(false);
  const [editingMode, setEditingMode] = useState(null);

  const [tvConfig, setTvConfig] = useState(loadTvConfig);
  const [tvSaved, setTvSaved] = useState('');

  const refreshStatus = () => fetchApiKeyStatus().then(setStatus).catch(() => {});

  useEffect(() => {
    refreshStatus();
  }, []);

  useEffect(() => {
    if (status?.tradingMode) setTradingModeState(status.tradingMode);
  }, [status?.tradingMode]);

  const handleTest = async () => {
    if (!apiKey || !apiSecret) {
      setMessage('Enter API key and secret first.');
      return;
    }
    setTesting(true);
    setMessage('');
    try {
      const res = await testApiKeys({ apiKey, apiSecret, mode: keyMode });
      const label = keyMode === 'live' ? 'Live Mainnet' : 'Demo Futures';
      setMessage(`✅ Connected! Balance: ${res.balance?.toFixed(2)} USDT (${label})`);
    } catch (err) {
      setMessage(`❌ ${err.message || 'Connection failed'}`);
    }
    setTesting(false);
  };

  const handleSave = async (mode = keyMode) => {
    if (!apiKey || !apiSecret) {
      setMessage('Enter API key and secret first.');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const res = await saveApiKeys({ apiKey, apiSecret, mode });
      setMessage(`✅ ${res.message}. Balance: ${res.balance?.toFixed(2)} USDT`);
      setApiKey('');
      setApiSecret('');
      setEditingMode(null);
      await refreshStatus();
      window.dispatchEvent(new Event('balance-updated'));
    } catch (err) {
      setMessage(`❌ ${err.message || 'Save failed'}`);
    }
    setSaving(false);
  };

  const handleTradingModeSwitch = async (mode) => {
    if (mode === tradingMode) return;

    const hasKeys = mode === 'live' ? status?.liveConfigured : status?.demoConfigured;
    if (!hasKeys) {
      setKeyMode(mode);
      setEditingMode(mode);
      setMessage(`Add ${mode} API keys below before switching to ${mode} trading.`);
      return;
    }

    setSwitchingMode(true);
    setMessage('');
    try {
      const res = await setTradingMode(mode);
      setTradingModeState(mode);
      setMessage(`✅ ${res.message}`);
      await refreshStatus();
      window.dispatchEvent(new Event('balance-updated'));
    } catch (err) {
      setMessage(`❌ ${err.message || 'Mode switch failed'}`);
    }
    setSwitchingMode(false);
  };

  const openKeyEditor = (mode) => {
    setKeyMode(mode);
    setEditingMode(mode);
    setApiKey('');
    setApiSecret('');
    setMessage('');
  };

  const saveTvSettings = () => {
    saveTvConfig(tvConfig);
    window.dispatchEvent(new Event('tv-config-updated'));
    setTvSaved('Chart settings saved. Reload Trading page to apply default mode.');
    setTimeout(() => setTvSaved(''), 4000);
  };

  const isLive = tradingMode === 'live';
  const demoSaved = status?.demoConfigured;
  const liveSaved = status?.liveConfigured;

  const renderKeyCard = (mode) => {
    const saved = mode === 'live' ? liveSaved : demoSaved;
    const isEditing = editingMode === mode;
    const label = mode === 'live' ? 'Live' : 'Demo';
    const icon = mode === 'live' ? '⚡' : '🧪';

    return (
      <div key={mode} className={`key-account-card ${saved ? 'saved' : ''} ${mode}`}>
        <div className="key-account-head">
          <span className="key-account-icon">{icon}</span>
          <div>
            <strong>{label} account</strong>
            <p>{mode === 'live' ? 'binance.com — real USDT' : 'demo.binance.com — paper futures'}</p>
          </div>
          <span className={`key-badge ${saved ? 'ok' : 'missing'}`}>
            {saved ? '✅ Saved' : 'Not set'}
          </span>
        </div>

        {saved && !isEditing ? (
          <div className="key-account-saved">
            <p>API keys encrypted in Supabase. Keys are never shown again after save.</p>
            <button type="button" className="secondary-btn" onClick={() => openKeyEditor(mode)}>
              Replace {label.toLowerCase()} keys
            </button>
          </div>
        ) : (
          <div className="key-account-form">
            <div className="form-row">
              <label>API Key</label>
              <input
                type="password"
                value={keyMode === mode ? apiKey : ''}
                onChange={(e) => { setKeyMode(mode); setApiKey(e.target.value); }}
                placeholder={`${label} Binance Futures API key`}
                autoComplete="off"
              />
            </div>
            <div className="form-row">
              <label>API Secret</label>
              <input
                type="password"
                value={keyMode === mode ? apiSecret : ''}
                onChange={(e) => { setKeyMode(mode); setApiSecret(e.target.value); }}
                placeholder={`${label} API secret`}
                autoComplete="off"
              />
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={handleTest}
                disabled={testing || keyMode !== mode}
              >
                {testing && keyMode === mode ? 'Testing…' : 'Test Connection'}
              </button>
              <button
                type="button"
                className="primary-btn"
                onClick={() => handleSave(mode)}
                disabled={saving || keyMode !== mode || !apiKey || !apiSecret}
              >
                {saving && keyMode === mode ? 'Saving…' : `Save ${label} Keys`}
              </button>
              {saved && (
                <button type="button" className="text-btn" onClick={() => setEditingMode(null)}>
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="settings-page">
      <header className="page-header">
        <h2>Settings</h2>
        <span className="page-sub">Binance Futures — demo & live trading</span>
      </header>

      <div className="settings-card">
        <h3>Trading account mode</h3>
        <p className="settings-intro">
          Active mode controls <strong>balance, orders, and positions</strong> across the dashboard.
        </p>

        <div className="trading-mode-switcher">
          <button
            type="button"
            className={`mode-btn ${!isLive ? 'active demo' : ''}`}
            disabled={switchingMode}
            onClick={() => handleTradingModeSwitch('demo')}
          >
            <span className="mode-icon">🧪</span>
            <span className="mode-label">Demo</span>
            <span className="mode-sub">{demoSaved ? 'Paper futures' : 'Add keys below'}</span>
          </button>
          <button
            type="button"
            className={`mode-btn ${isLive ? 'active live' : ''}`}
            disabled={switchingMode}
            onClick={() => handleTradingModeSwitch('live')}
          >
            <span className="mode-icon">⚡</span>
            <span className="mode-label">Live</span>
            <span className="mode-sub">{liveSaved ? 'Real funds' : 'Add keys below'}</span>
          </button>
        </div>

        <div className={`mode-banner ${isLive ? 'live' : 'demo'}`}>
          {isLive ? (
            <>⚠️ <strong>LIVE MODE</strong> — trades execute on mainnet with real USDT</>
          ) : (
            <>🧪 <strong>DEMO MODE</strong> — trades execute on Binance demo futures</>
          )}
        </div>
      </div>

      <div className="settings-card">
        <h3>Binance API keys</h3>
        <p className="settings-intro">
          Keys are encrypted and stored in <strong>Supabase</strong> linked to your login.
          Enable <strong>Futures only</strong> — never enable withdrawals.
        </p>

        {renderKeyCard('demo')}
        {renderKeyCard('live')}

        {message && <p className="form-message">{message}</p>}

        <div className="settings-warning">
          <strong>Security:</strong> Saved once per account — survives reload, restart, and new devices when signed in.
        </div>
      </div>

      <div className="settings-card">
        <h3>TradingView Chart (required for E5 + backtest)</h3>
        <p className="settings-intro">
          Your site uses the <strong>TradingView chart widget</strong> for live market data and tools.
          Your private <strong>Smart Money Algo Pro E5</strong> script runs on TradingView when you open your saved chart — Strategy Tester backtest is there too.
        </p>

        <div className="form-row">
          <label>Your saved chart URL (with E5 loaded)</label>
          <input
            type="url"
            value={tvConfig.chartLayoutUrl}
            onChange={(e) => setTvConfig({ ...tvConfig, chartLayoutUrl: e.target.value })}
            placeholder="https://www.tradingview.com/chart/AbCdEfGh/?symbol=BINANCE:BTCUSDT"
          />
          <span className="field-hint">
            In TradingView: load E5 → Save layout → copy browser URL → paste here.
          </span>
        </div>

        <div className="form-row">
          <label>Published Pine study ID (optional — widget only)</label>
          <input
            type="text"
            value={tvConfig.pineStudyId}
            onChange={(e) => setTvConfig({ ...tvConfig, pineStudyId: e.target.value })}
            placeholder="Only if you published E5 publicly on TradingView"
          />
        </div>

        <div className="form-actions">
          <button type="button" className="primary-btn" onClick={saveTvSettings}>Save Chart Settings</button>
        </div>
        {tvSaved && <p className="form-message success">{tvSaved}</p>}

        <div className="settings-steps">
          <h4>Setup (one time)</h4>
          <ol>
            <li>Log in at <a href="https://www.tradingview.com" target="_blank" rel="noopener noreferrer">tradingview.com</a>.</li>
            <li>Open a <strong>new blank chart</strong> (do not copy a shared layout with many indicators).</li>
            <li>Add <strong>only</strong> Smart Money Algo Pro E5 from My scripts.</li>
            <li>Remove any other indicators (free plan allows ~2 studies per chart).</li>
            <li>File → Save layout → copy URL → paste above → Save.</li>
          </ol>
        </div>
      </div>

      <div className="settings-card">
        <h3>Strategy Rules (SMC-MTF)</h3>
        <ul className="rules-list">
          <li>🟢 <strong>BUY</strong> only when RSI &lt; 30 (ideal &lt; 25)</li>
          <li>🔴 <strong>SHORT</strong> only when RSI &gt; 70 (ideal &gt; 80)</li>
          <li>MTF: 1H trend → 30M confirm → 15M OB → 5M entry</li>
          <li>Scanner OFF by default — Telegram <code>/startT</code> or dashboard toggle</li>
        </ul>
      </div>
    </div>
  );
}
