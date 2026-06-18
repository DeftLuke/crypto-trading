-- Phase 5 — Qdrant Memory Layer audit & metadata (PostgreSQL)
-- Vector storage lives in Qdrant; this table is for audit, RBAC, and integrity.

CREATE TABLE IF NOT EXISTS research_memory_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id TEXT NOT NULL,
    collection TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('store', 'update', 'delete', 'recall', 'search')),
    user_id TEXT,
    role TEXT,
    payload_hash TEXT,
    latency_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_audit_memory_id ON research_memory_audit(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_audit_collection ON research_memory_audit(collection, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_audit_user ON research_memory_audit(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS research_memory_worker_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status TEXT NOT NULL DEFAULT 'running',
    trades_analyzed INTEGER DEFAULT 0,
    patterns_discovered INTEGER DEFAULT 0,
    reflections_generated INTEGER DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_memory_worker_started ON research_memory_worker_runs(started_at DESC);

COMMENT ON TABLE research_memory_audit IS 'Phase 5 memory operation audit log';
COMMENT ON TABLE research_memory_worker_runs IS 'Phase 5 continuous learning worker run history';
