export default function MarketStructurePanel({ smc, livePrice }) {
  if (!smc) return null;

  const rows = [];

  const demand = (smc.orderBlocks || []).filter((b) => b.type === 'demand' && !b.mitigated).slice(-1)[0];
  const supply = (smc.orderBlocks || []).filter((b) => b.type === 'supply' && !b.mitigated).slice(-1)[0];
  if (demand) rows.push({ label: 'OB Demand', price: demand.low, color: '#3fb950' });
  if (supply) rows.push({ label: 'OB Supply', price: supply.high, color: '#f85149' });

  for (const rz of (smc.retestZones || []).slice(-1)) {
    rows.push({ label: 'OB Retest', price: (rz.high + rz.low) / 2, color: '#d29922' });
  }

  for (const fvg of (smc.fvgZones || []).slice(-2)) {
    rows.push({ label: fvg.label || 'FVG', price: (fvg.high + fvg.low) / 2, color: '#58a6ff' });
  }

  for (const idm of (smc.idmZones || []).slice(-1)) {
    rows.push({ label: 'IDM', price: idm.price, color: '#bc8cff' });
  }

  if (smc.lastBOS) {
    rows.push({ label: `BOS ${smc.lastBOS.direction}`, price: smc.lastBOS.price, color: '#3fb950' });
  }
  if (smc.lastCHoCH) {
    rows.push({ label: `CHoCH ${smc.lastCHoCH.direction}`, price: smc.lastCHoCH.price, color: '#f85149' });
  }

  for (const sw of (smc.sweeps || []).slice(-1)) {
    rows.push({ label: sw.type.includes('bull') ? 'Liq Sweep ↑' : 'Liq Sweep ↓', price: sw.level, color: '#d29922' });
  }

  if (!rows.length) return null;

  return (
    <div className="structure-panel">
      <div className="structure-title">Market Structure</div>
      {rows.map((r) => (
        <div key={r.label + r.price} className="structure-row">
          <span className="structure-label" style={{ color: r.color }}>{r.label}</span>
          <span className="structure-price">${Number(r.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        </div>
      ))}
      {livePrice && (
        <div className="structure-row structure-live">
          <span>Live</span>
          <span>${Number(livePrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        </div>
      )}
    </div>
  );
}
