const TF_ICONS = { bullish: '🟢', bearish: '🔴', neutral: '⚪' };

export default function MTFBiasPanel({ mtf, symbol }) {
  if (!mtf?.timeframes) return null;

  const overall = mtf.overall || 'neutral';
  const overallColor = overall.includes('bull') ? 'var(--green)' : overall.includes('bear') ? 'var(--red)' : 'var(--text-secondary)';

  return (
    <div className="mtf-panel">
      <div className="mtf-header">
        <span className="mtf-symbol">{symbol.replace('USDT', '')}</span>
        <span className="mtf-overall" style={{ color: overallColor }}>
          {overall.toUpperCase()}
        </span>
      </div>
      <div className="mtf-grid">
        {Object.entries(mtf.timeframes).map(([tf, d]) => (
          <div key={tf} className="mtf-row">
            <span className="mtf-tf">{tf}</span>
            <span>{TF_ICONS[d.trend] || '⚪'} {d.trend}</span>
            <span className="mtf-meta">RSI {d.rsi}</span>
            {d.bos && <span className="mtf-tag bos">BOS</span>}
            {d.choch && <span className="mtf-tag choch">CHoCH</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
