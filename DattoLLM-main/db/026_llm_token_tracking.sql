-- 026: Add per-stage token tracking to llm_request_logs
-- Tracks prompt/completion tokens, cost, model, provider, and data mode for each LLM stage

ALTER TABLE llm_request_logs
  ADD COLUMN IF NOT EXISTS data_mode             TEXT,
  ADD COLUMN IF NOT EXISTS prequery_hit           BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS prequery_tool          TEXT,
  -- Stage 1: Orchestrator totals (summed across all iterations)
  ADD COLUMN IF NOT EXISTS orchestrator_provider  TEXT,
  ADD COLUMN IF NOT EXISTS orch_prompt_tokens     INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS orch_completion_tokens INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS orch_total_tokens      INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS orch_iterations        INTEGER DEFAULT 0,
  -- Stage 2: Synthesizer totals
  ADD COLUMN IF NOT EXISTS synth_provider         TEXT,
  ADD COLUMN IF NOT EXISTS synth_prompt_tokens    INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS synth_completion_tokens INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS synth_total_tokens     INTEGER DEFAULT 0,
  -- Combined
  ADD COLUMN IF NOT EXISTS total_prompt_tokens    INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_completion_tokens INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_tokens           INTEGER DEFAULT 0,
  -- Timing
  ADD COLUMN IF NOT EXISTS orch_duration_ms       INTEGER,
  ADD COLUMN IF NOT EXISTS synth_duration_ms      INTEGER,
  ADD COLUMN IF NOT EXISTS total_duration_ms      INTEGER,
  -- Tool results
  ADD COLUMN IF NOT EXISTS tool_result_chars      INTEGER DEFAULT 0;

-- Index for token analysis queries
CREATE INDEX IF NOT EXISTS idx_llm_logs_tokens ON llm_request_logs (created_at DESC, total_tokens);
CREATE INDEX IF NOT EXISTS idx_llm_logs_provider ON llm_request_logs (orchestrator_provider, synth_provider, created_at DESC);
