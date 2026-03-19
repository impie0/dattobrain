-- SEC-Write-001: ActionProposal state machine for write tool execution.
--
-- Design principle: the LLM can never execute a write operation directly.
-- Instead it stages an ActionProposal. The user reviews and confirms (or
-- rejects) it. Only a confirmed proposal proceeds to execution.
--
-- This table is created now so the pattern is established before any write
-- tools exist. The chat pipeline will be updated to produce proposals instead
-- of executing write tools when the first write tool is added.
--
-- State machine:
--   pending  → confirmed (user confirms within expires_at window)
--   pending  → rejected  (user rejects)
--   pending  → expired   (read-time check: now() > expires_at)
--   confirmed → executed (system executes the staged tool call)
--   confirmed → rejected (user changes mind before execution starts)
--
-- SEC-Write-004: Parameter masking
--   Sensitive fields (passwords, API keys, secrets) are replaced with "***"
--   in tool_args_masked before storage. The unmasked args are never persisted.
--   The execution layer receives unmasked args from the in-memory proposal
--   context, not from this table.

CREATE TABLE IF NOT EXISTS action_proposals (
  id                uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id        uuid        REFERENCES chat_sessions(id) ON DELETE SET NULL,
  tool_name         text        NOT NULL,
  -- Masked tool arguments for display and audit — sensitive values replaced with "***"
  tool_args_masked  jsonb       NOT NULL DEFAULT '{}',
  proposed_at       timestamptz NOT NULL DEFAULT now(),
  -- Proposals expire after 15 minutes if not confirmed
  expires_at        timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  status            text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'confirmed', 'rejected', 'executed', 'expired')),
  confirmed_at      timestamptz,
  executed_at       timestamptz,
  -- JSON result from the write tool execution (success or error)
  execution_result  jsonb,
  -- Correlates this proposal back to the chat request that generated it
  request_id        text        NOT NULL,
  ip_address        text
);

-- Fast lookup: all pending proposals for a user (confirmation UI polling)
CREATE INDEX IF NOT EXISTS action_proposals_user_pending_idx
  ON action_proposals (user_id, expires_at)
  WHERE status = 'pending';

-- Fast lookup: proposals by session (conversation context)
CREATE INDEX IF NOT EXISTS action_proposals_session_idx
  ON action_proposals (session_id);

-- Fast sweep: find expired pending proposals for cleanup
CREATE INDEX IF NOT EXISTS action_proposals_expiry_idx
  ON action_proposals (expires_at)
  WHERE status = 'pending';
