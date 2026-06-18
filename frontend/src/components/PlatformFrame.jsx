export default function PlatformFrame({ path, title }) {
  const base = (import.meta.env.VITE_PLATFORM_URL || '').replace(/\/$/, '');
  const src = base ? `${base}${path}` : (import.meta.env.DEV ? `http://localhost:3000${path}` : '');

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
