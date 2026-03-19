-- Performance indexes for observability dashboard queries
-- These cover the common time-windowed aggregation patterns used by /api/admin/observability/*

CREATE INDEX IF NOT EXISTS obs_audit_event_created
  ON audit_logs(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS obs_audit_tool_event_created
  ON audit_logs(tool_name, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS obs_llm_logs_created
  ON llm_request_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS obs_llm_models_created
  ON llm_request_logs(orchestrator_model, synthesizer_model, created_at DESC);

CREATE INDEX IF NOT EXISTS obs_chat_msgs_created
  ON chat_messages(created_at DESC);

CREATE INDEX IF NOT EXISTS obs_chat_msgs_session_role
  ON chat_messages(session_id, role, created_at DESC);

CREATE INDEX IF NOT EXISTS obs_sessions_updated
  ON chat_sessions(updated_at DESC);

CREATE INDEX IF NOT EXISTS obs_sessions_data_mode
  ON chat_sessions(data_mode, updated_at DESC);

CREATE INDEX IF NOT EXISTS obs_sync_log_started
  ON datto_sync_log(started_at DESC);
