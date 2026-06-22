export default function PlatformFrame({ path, title }) {
  const base = (import.meta.env.VITE_PLATFORM_URL || '').replace(/\/$/, '');
  const target = base ? `${base}${path}` : (import.meta.env.DEV ? `http://localhost:3000${path}` : '');
  // Tell the terminal it is embedded so it drops its own sidebar / top nav and
  // we render a single shell + single scroll container.
  const src = target ? `${target}${target.includes('?') ? '&' : '?'}embed=1` : '';

  if (!src) {
    return (
      <div className="platform-fallback">
        <div className="platform-fallback-inner">
          <h2>{title || 'Institutional Platform'}</h2>
          <p>
            Set <code>VITE_PLATFORM_URL</code> in production and rebuild the frontend image.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="platform-frame-wrap">
      <iframe
        className="platform-frame"
        src={src}
        title={title || 'Platform'}
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
