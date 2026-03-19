-- 017_request_traces.sql — Full request trace observability
-- Captures the complete journey of every chat request through all services
-- with expandable payloads at each hop.

CREATE TABLE IF NOT EXISTS request_traces (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid,
  user_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  username         text,
  question         text,
  status           text NOT NULL DEFAULT 'in_progress',
  tool_count       int NOT NULL DEFAULT 0,
  total_duration_ms int,
  error_message    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz
);

CREATE TABLE IF NOT EXISTS request_trace_spans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id         uuid NOT NULL REFERENCES request_traces(id) ON DELETE CASCADE,
  parent_span_id   uuid REFERENCES request_trace_spans(id) ON DELETE SET NULL,
  service          text NOT NULL,
  operation        text NOT NULL,
  status           text NOT NULL DEFAULT 'ok',
  started_at       timestamptz NOT NULL DEFAULT now(),
  ended_at         timestamptz,
  duration_ms      int,
  request_payload  jsonb,
  response_payload jsonb,
  metadata         jsonb,
  error_message    text
);

-- Performance indexes
CREATE INDEX idx_traces_created_at   ON request_traces (created_at DESC);
CREATE INDEX idx_traces_user_id      ON request_traces (user_id, created_at DESC);
CREATE INDEX idx_traces_status       ON request_traces (status) WHERE status != 'completed';
CREATE INDEX idx_trace_spans_trace   ON request_trace_spans (trace_id, started_at);
