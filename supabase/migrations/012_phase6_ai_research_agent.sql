-- Phase 6 — AI Research Agent audit trail

CREATE TABLE IF NOT EXISTS research_agent_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_id INTEGER,
    agent_name TEXT NOT NULL,
    action TEXT NOT NULL,
    reasoning TEXT,
    evidence JSONB DEFAULT '{}',
    supporting_memories JSONB DEFAULT '[]',
    decision_ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    duration_ms INTEGER,
    user_id TEXT,
    role TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_audit_ts ON research_agent_audit(decision_ts DESC);
CREATE INDEX IF NOT EXISTS idx_agent_audit_agent ON research_agent_audit(agent_name, decision_ts DESC);

CREATE TABLE IF NOT EXISTS research_agent_cycles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_number INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    hypotheses_generated INTEGER DEFAULT 0,
    strategies_evaluated INTEGER DEFAULT 0,
    reflections_generated INTEGER DEFAULT 0,
    top_strategy TEXT,
    top_score NUMERIC,
    regime TEXT,
    error_message TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_agent_cycles_started ON research_agent_cycles(started_at DESC);

COMMENT ON TABLE research_agent_audit IS 'Phase 6 — audit log for all AI agent decisions';
COMMENT ON TABLE research_agent_cycles IS 'Phase 6 — research cycle history';
