import { useEffect, useState } from 'react';
import {
  fetchApiKeyStatus,
  saveApiKeys,
  testApiKeys,
} from '../services/api';

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [testnet, setTestnet] = useState(true);
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchApiKeyStatus().then(setStatus).catch(() => {});
  }, []);

  const handleTest = async () => {
    if (!apiKey || !apiSecret) {
      setMessage('Enter API key and secret first.');
      return;
    }
    setTesting(true);
    setMessage('');
    try {
      const res = await testApiKeys({ apiKey, apiSecret, testnet });
      setMessage(`✅ Connected! Balance: ${res.balance?.toFixed(2)} USDT (${testnet ? 'Testnet' : 'Live'})`);
    } catch (err) {
      setMessage(`❌ ${err.message || 'Connection failed'}`);
    }
    setTesting(false);
  };

  const handleSave = async () => {
    if (!apiKey || !apiSecret) {
      setMessage('Enter API key and secret first.');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const res = await saveApiKeys({ apiKey, apiSecret, testnet });
      setMessage(`✅ Keys saved. Balance: ${res.balance?.toFixed(2)} USDT`);
      setStatus({ configured: true, source: 'runtime', testnet });
      setApiKey('');
      setApiSecret('');
    } catch (err) {
      setMessage(`❌ ${err.message || 'Save failed'}`);
    }
    setSaving(false);
  };

  return (
    <div className="settings-page">
      <header className="page-header">
        <h2>Settings</h2>
        <span className="page-sub">Binance Futures API for live trading</span>
      </header>

      <div className="settings-card">
        <h3>Binance Futures API</h3>
        {status?.configured && (
          <p className="status-ok">
            ✅ API keys configured ({status.source}) — {status.testnet ? 'Testnet' : 'Live'}
          </p>
        )}

        <div className="form-row">
          <label>API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Your Binance Futures API key"
          />
        </div>

        <div className="form-row">
          <label>API Secret</label>
          <input
            type="password"
            value={apiSecret}
            onChange={(e) => setApiSecret(e.target.value)}
            placeholder="Your Binance Futures API secret"
          />
        </div>

        <div className="form-row checkbox-row">
          <label>
            <input type="checkbox" checked={testnet} onChange={(e) => setTestnet(e.target.checked)} />
            Use Testnet (recommended for testing)
          </label>
        </div>

        <div className="form-actions">
          <button type="button" className="secondary-btn" onClick={handleTest} disabled={testing}>
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
          <button type="button" className="primary-btn" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save & Enable Trading'}
          </button>
        </div>

        {message && <p className="form-message">{message}</p>}

        <div className="settings-warning">
          <strong>Security:</strong> Keys are encrypted in database or held in server memory.
          Use testnet first. Never share your API keys. Enable Futures only, no withdrawals.
        </div>
      </div>

      <div className="settings-card">
        <h3>Strategy Rules (SMC-MTF)</h3>
        <ul className="rules-list">
          <li>🟢 <strong>BUY</strong> only when RSI &lt; 30 (ideal &lt; 25)</li>
          <li>🔴 <strong>SHORT</strong> only when RSI &gt; 70 (ideal &gt; 80)</li>
          <li>MTF: 1H trend → 30M confirm → 15M OB → 5M entry</li>
          <li>OB retest + rejection candle required</li>
          <li>Scanner OFF by default — Telegram <code>/startT</code> or dashboard toggle</li>
          <li>All USDT perpetual futures scanned (not just 20 coins)</li>
          <li>Same signal blocked for 1 hour cooldown</li>
          <li>Loss patterns auto-blocked from lessons</li>
        </ul>
      </div>
    </div>
  );
}
