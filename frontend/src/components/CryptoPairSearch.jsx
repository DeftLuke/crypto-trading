import { useCallback, useEffect, useRef, useState } from 'react';
import { searchTvPairs } from '../services/api';

export default function CryptoPairSearch({ tvSymbol, onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);
  const wrapRef = useRef(null);

  const runSearch = useCallback(async (q) => {
    if (!q || q.length < 1) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const data = await searchTvPairs(q);
      setResults(data.results || []);
      setOpen(true);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query.trim()), 280);
    return () => clearTimeout(debounceRef.current);
  }, [query, runSearch]);

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (item) => {
    onSelect(item);
    setQuery('');
    setOpen(false);
    setResults([]);
  };

  const displaySymbol = tvSymbol?.split(':').pop() || 'BTCUSDT';

  return (
    <div className="crypto-pair-search" ref={wrapRef}>
      <span className="crypto-search-icon">⌕</span>
      <input
        type="search"
        className="crypto-search-input"
        placeholder={`Search crypto pairs… (${displaySymbol})`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => { if (results.length) setOpen(true); }}
      />
      {loading && <span className="crypto-search-spinner">…</span>}
      {open && results.length > 0 && (
        <ul className="crypto-search-results">
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" className="crypto-search-item" onClick={() => pick(r)}>
                <span className="crypto-search-sym">{r.symbol}</span>
                <span className="crypto-search-ex">{r.exchange}</span>
                <span className="crypto-search-desc">{r.description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && !loading && query.length >= 1 && results.length === 0 && (
        <div className="crypto-search-empty">No crypto pairs found</div>
      )}
    </div>
  );
}
