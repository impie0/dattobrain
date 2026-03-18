-- ============================================================
--  Migration 012 — LLM routing configuration table
--  Stores per-slot model assignments editable from admin UI.
--  No rebuild required to change models — just update rows.
-- ============================================================

CREATE TABLE IF NOT EXISTS llm_routing_config (
  key         text PRIMARY KEY,
  model       text NOT NULL,
  description text
);

-- Default routing config.
-- orchestrator_* = Stage 1 (tool selection) — must be a claude-* model.
-- synthesizer_* = Stage 2 (response writing) — any model.
-- default_data_mode stores "cached" or "live" in the model column.

INSERT INTO llm_routing_config (key, model, description) VALUES
  ('orchestrator_default',   'claude-haiku-4-5-20251001', 'Default model for tool selection (Stage 1)'),
  ('orchestrator_high_risk', 'claude-opus-4-6',           'Stage 1 model when high-risk tools are in scope'),
  ('synthesizer_default',    'claude-haiku-4-5-20251001', 'Default model for response writing (Stage 2)'),
  ('synthesizer_large_data', 'deepseek/deepseek-r1',      'Stage 2 when total tool result exceeds 8000 chars'),
  ('synthesizer_high_risk',  'claude-opus-4-6',           'Stage 2 when a high-risk tool was called'),
  ('synthesizer_cached',     'claude-haiku-4-5-20251001', 'Stage 2 for cached-mode queries'),
  ('default_data_mode',      'cached',                    'Default data mode for new sessions: cached or live')
ON CONFLICT (key) DO NOTHING;
