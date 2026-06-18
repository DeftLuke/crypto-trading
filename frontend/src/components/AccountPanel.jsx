import { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';

export default function AccountPanel({ open, onClose }) {
  const { user, signOut } = useAuth();
  const { balance, autoTrade, scannerOn, tradingMode } = useApp();
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, onClose]);

  if (!open) return null;

  const available = balance?.available != null ? parseFloat(balance.available).toFixed(2) : '—';

  return (
    <div className="account-panel" ref={ref}>
      <div className="account-panel-head">
        <strong>Account</strong>
        <span className="account-email">{user?.email || 'Guest'}</span>
      </div>
      <dl className="account-stats">
        <div><dt>Balance</dt><dd>{available} USDT</dd></div>
        <div><dt>Mode</dt><dd className="cap">{tradingMode}</dd></div>
        <div><dt>Scanner</dt><dd>{scannerOn ? 'Running' : 'Stopped'}</dd></div>
        <div><dt>Auto trade</dt><dd>{autoTrade ? 'Enabled' : 'Disabled'}</dd></div>
      </dl>
      {user && (
        <button type="button" className="account-signout" onClick={signOut}>
          Sign out
        </button>
      )}
    </div>
  );
}
