export default function PageTransitionLoader({ label = 'Loading' }) {
  return (
    <div className="page-transition-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="page-transition-card">
        <div className="page-transition-spinner" aria-hidden="true">
          <span /><span /><span />
        </div>
        <p className="page-transition-label">{label}</p>
        <div className="page-transition-bar">
          <div className="page-transition-bar-fill" />
        </div>
      </div>
    </div>
  );
}
