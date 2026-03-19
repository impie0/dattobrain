-- Missing tables that other migrations and services depend on.
-- Must run before 013_llm_logs_models.sql (which alters llm_request_logs).

-- LLM request logs — stores every chat request payload for debugging/observability
CREATE TABLE IF NOT EXISTS llm_request_logs (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id    uuid REFERENCES chat_sessions(id) ON DELETE SET NULL,
  user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  system_prompt text,
  messages      jsonb DEFAULT '[]',
  tool_names    text[] DEFAULT '{}',
  tools_payload jsonb DEFAULT '[]',
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS llm_request_logs_user_id_idx ON llm_request_logs (user_id);
CREATE INDEX IF NOT EXISTS llm_request_logs_created_at_idx ON llm_request_logs (created_at DESC);

-- Tool policies — per-tool metadata (risk level, approval gating)
CREATE TABLE IF NOT EXISTS tool_policies (
  tool_name         text PRIMARY KEY,
  risk_level        text NOT NULL DEFAULT 'low',
  approval_required boolean NOT NULL DEFAULT false,
  description       text
);

-- Seed default tool policies for all 37 tools (low risk, no approval)
INSERT INTO tool_policies (tool_name) VALUES
  ('get-account'), ('list-sites'), ('list-devices'), ('list-users'),
  ('list-account-variables'), ('list-components'), ('list-open-alerts'),
  ('list-resolved-alerts'), ('get-site'), ('list-site-devices'),
  ('list-site-open-alerts'), ('list-site-resolved-alerts'),
  ('list-site-variables'), ('get-site-settings'), ('list-site-filters'),
  ('get-device'), ('get-device-by-id'), ('get-device-by-mac'),
  ('list-device-open-alerts'), ('list-device-resolved-alerts'),
  ('get-alert'), ('get-job'), ('get-job-components'), ('get-job-results'),
  ('get-job-stdout'), ('get-job-stderr'), ('get-device-audit'),
  ('get-device-software'), ('get-device-audit-by-mac'), ('get-esxi-audit'),
  ('get-printer-audit'), ('get-activity-logs'), ('list-default-filters'),
  ('list-custom-filters'), ('get-system-status'), ('get-rate-limit'),
  ('get-pagination-config')
ON CONFLICT (tool_name) DO NOTHING;

-- Per-user tool overrides (extra tools beyond role grants)
CREATE TABLE IF NOT EXISTS user_tool_overrides (
  user_id   uuid REFERENCES users(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  PRIMARY KEY (user_id, tool_name)
);

-- Approvals — tool call approval requests (for high-risk tools)
CREATE TABLE IF NOT EXISTS approvals (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  requester_id  uuid REFERENCES users(id) ON DELETE CASCADE,
  tool_name     text NOT NULL,
  parameters    jsonb DEFAULT '{}',
  risk_level    text DEFAULT 'low',
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at   timestamptz,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS approvals_requester_idx ON approvals (requester_id);
CREATE INDEX IF NOT EXISTS approvals_status_idx ON approvals (status) WHERE status = 'pending';
