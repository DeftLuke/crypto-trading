import { useEffect, useState } from 'react';
import {
  fetchControlSettings,
  fetchSignalEngineStatus,
  setSignalEngine,
  updateControlSettings,
} from '../services/api';

const DEFAULTS = {
  risk_per_trade_pct: 1,
  default_leverage: 50,
  max_open_trades: 5,
  max_daily_loss_pct: 3,
  max_drawdown_pct: 10,
  institutional_min_score: 80,
  auto_trading: true,
  manual_approval: false,
  scanner_enabled: true,
  telegram_signals_enabled: true,
  signal_engine: 'smc-mtf',
};

function Toggle({ checked, onChange, disabled, label }) {
  return (
    <label className={`risk-toggle ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="risk-toggle-track" />
      <span className="risk-toggle-label">{label}</span>
    </label>
  );
}

export default function RiskControlPanel({ compact = false }) {
  const [settings, setSettings] = useState(null);
  const [engine, setEngine] = useState(null);
  const [draft, setDraft] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function refresh() {
    const [s, e] = await Promise.all([
      fetchControlSettings().catch(() => null),
      fetchSignalEngineStatus().catch(() => null),
    ]);
    setSettings(s);
    setEngine(e);
    if (s) {
      setDraft({
        risk_per_trade_pct: s.risk_per_trade_pct ?? DEFAULTS.risk_per_trade_pct,
        default_leverage: s.default_leverage ?? DEFAULTS.default_leverage,
        max_open_trades: s.max_open_trades ?? DEFAULTS.max_open_trades,
        max_daily_loss_pct: s.max_daily_loss_pct ?? DEFAULTS.max_daily_loss_pct,
        max_drawdown_pct: s.max_drawdown_pct ?? DEFAULTS.max_drawdown_pct,
        institutional_min_score: s.institutional_min_score ?? e?.institutional_smc?.min_score ?? DEFAULTS.institutional_min_score,
        auto_trading: s.auto_trading ?? DEFAULTS.auto_trading,
        manual_approval: s.manual_approval ?? DEFAULTS.manual_approval,
        scanner_enabled: s.scanner_enabled ?? DEFAULTS.scanner_enabled,
        telegram_signals_enabled: s.telegram_signals_enabled ?? DEFAULTS.telegram_signals_enabled,
        signal_engine: e?.active_engine || s.signal_engine || DEFAULTS.signal_engine,
      });
    }
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  const activeEngine = engine?.active_engine || draft.signal_engine;
  const institutionalAvailable = engine?.institutional_smc?.available !== false;

  async function handleSaveRisk() {
    setSaving(true);
    setMessage('');
    try {
      const updated = await updateControlSettings({
        risk_per_trade_pct: parseFloat(draft.risk_per_trade_pct),
        default_leverage: parseInt(draft.default_leverage, 10),
        max_open_trades: parseInt(draft.max_open_trades, 10),
        max_daily_loss_pct: parseFloat(draft.max_daily_loss_pct),
        max_drawdown_pct: parseFloat(draft.max_drawdown_pct),
        institutional_min_score: parseInt(draft.institutional_min_score, 10),
        auto_trading: draft.auto_trading,
        manual_approval: draft.manual_approval,
        scanner_enabled: draft.scanner_enabled,
        telegram_signals_enabled: draft.telegram_signals_enabled,
      });
      setSettings(updated);
      setMessage('Risk settings saved.');
    } catch (err) {
      setMessage(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleEngineChange(next) {
    setMessage('');
    try {
      const res = await setSignalEngine(next);
      setEngine(res.signal_engine);
      setDraft((d) => ({ ...d, signal_engine: res.signal_engine?.active_engine || next }));
      setMessage(`Signal engine: ${next === 'institutional-smc' ? 'Institutional SMC v2' : 'SMC-MTF Legacy'}`);
    } catch (err) {
      setMessage(err.message || 'Engine switch failed');
    }
  }

  if (loading) return <p className="settings-intro">Loading risk controls…</p>;

  return (
    <div className={`risk-control-panel ${compact ? 'compact' : ''}`}>
      <section className="risk-section">
        <h4>Signal engine</h4>
        <p className="settings-intro">
          Choose which SMC engine generates scanner + auto-trade signals. Institutional v2 uses Python research-api with a minimum score gate.
        </p>
        <div className="engine-switcher">
          <button
            type="button"
            className={`engine-btn ${activeEngine === 'smc-mtf' ? 'active' : ''}`}
            onClick={() => handleEngineChange('smc-mtf')}
          >
            <strong>SMC-MTF Legacy</strong>
            <span>Node.js · RSI + MTF structure</span>
            <span className={`engine-badge ${engine?.smc_mtf?.available ? 'ok' : ''}`}>
              {engine?.smc_mtf?.available ? 'Available' : 'Offline'}
            </span>
          </button>
          <button
            type="button"
            className={`engine-btn institutional ${activeEngine === 'institutional-smc' ? 'active' : ''}`}
            disabled={!institutionalAvailable}
            onClick={() => handleEngineChange('institutional-smc')}
          >
            <strong>Institutional SMC v2</strong>
            <span>Python · CP6 modules · score gate</span>
            <span className={`engine-badge ${institutionalAvailable ? 'ok' : 'warn'}`}>
              {institutionalAvailable ? 'Available' : 'Needs research-api'}
            </span>
          </button>
        </div>
        <p className="field-hint">
          Active: <code>{activeEngine}</code>
          {activeEngine === 'institutional-smc' ? ` · min score ${draft.institutional_min_score}` : ''}
        </p>
      </section>

      <section className="risk-section">
        <h4>Institutional SMC v2 tuning</h4>
        <div className="risk-grid">
          <div className="form-row">
            <label>Minimum score (50–100)</label>
            <input
              type="number"
              min={50}
              max={100}
              value={draft.institutional_min_score}
              onChange={(e) => setDraft({ ...draft, institutional_min_score: e.target.value })}
            />
            <span className="field-hint">Higher = fewer but stricter signals. Default 80.</span>
          </div>
          <div className="form-row">
            <label>Default leverage</label>
            <input
              type="number"
              min={1}
              max={125}
              value={draft.default_leverage}
              onChange={(e) => setDraft({ ...draft, default_leverage: e.target.value })}
            />
          </div>
        </div>
      </section>

      <section className="risk-section">
        <h4>Risk limits</h4>
        <div className="risk-grid">
          <div className="form-row">
            <label>Risk per trade (%)</label>
            <input
              type="number"
              step="0.1"
              min={0.1}
              max={10}
              value={draft.risk_per_trade_pct}
              onChange={(e) => setDraft({ ...draft, risk_per_trade_pct: e.target.value })}
            />
          </div>
          <div className="form-row">
            <label>Max open trades</label>
            <input
              type="number"
              min={1}
              max={50}
              value={draft.max_open_trades}
              onChange={(e) => setDraft({ ...draft, max_open_trades: e.target.value })}
            />
          </div>
          <div className="form-row">
            <label>Max daily loss (%)</label>
            <input
              type="number"
              step="0.1"
              min={0.5}
              max={50}
              value={draft.max_daily_loss_pct}
              onChange={(e) => setDraft({ ...draft, max_daily_loss_pct: e.target.value })}
            />
          </div>
          <div className="form-row">
            <label>Max drawdown (%)</label>
            <input
              type="number"
              step="0.5"
              min={1}
              max={100}
              value={draft.max_drawdown_pct}
              onChange={(e) => setDraft({ ...draft, max_drawdown_pct: e.target.value })}
            />
          </div>
        </div>
      </section>

      <section className="risk-section">
        <h4>Automation</h4>
        <div className="risk-toggles">
          <Toggle label="Auto trading" checked={draft.auto_trading} onChange={(v) => setDraft({ ...draft, auto_trading: v })} />
          <Toggle label="Manual approval required" checked={draft.manual_approval} onChange={(v) => setDraft({ ...draft, manual_approval: v })} />
          <Toggle label="Market scanner" checked={draft.scanner_enabled} onChange={(v) => setDraft({ ...draft, scanner_enabled: v })} />
          <Toggle label="Telegram signals" checked={draft.telegram_signals_enabled} onChange={(v) => setDraft({ ...draft, telegram_signals_enabled: v })} />
        </div>
      </section>

      <div className="form-actions">
        <button type="button" className="primary-btn" onClick={handleSaveRisk} disabled={saving}>
          {saving ? 'Saving…' : 'Save risk settings'}
        </button>
      </div>

      {message && <p className={`form-message ${message.includes('failed') || message.includes('❌') ? '' : 'success'}`}>{message}</p>}
      {settings?.updated_at && (
        <p className="field-hint">Last saved {new Date(settings.updated_at).toLocaleString()}</p>
      )}
    </div>
  );
}
