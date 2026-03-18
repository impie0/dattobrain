-- Add orchestrator and synthesizer model columns to llm_request_logs
ALTER TABLE llm_request_logs
  ADD COLUMN IF NOT EXISTS orchestrator_model text,
  ADD COLUMN IF NOT EXISTS synthesizer_model  text,
  ADD COLUMN IF NOT EXISTS tools_called       text[] DEFAULT '{}';
