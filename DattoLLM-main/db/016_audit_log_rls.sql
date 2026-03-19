-- SEC-Audit-001: Audit log immutability via PostgreSQL Row Level Security.
--
-- Ensures the app database user cannot UPDATE or DELETE audit_log rows even if
-- application code has a bug or the running service is compromised.
--
-- How it works:
--   - RLS is enabled on audit_logs (non-superuser sessions are subject to policies)
--   - Two permissive policies are created: INSERT and SELECT
--   - No UPDATE or DELETE policy exists — RLS default-denies anything without a policy
--   - The postgres superuser bypasses RLS for administrative operations
--
-- Production hardening:
--   Create a dedicated low-privilege role and use it for all services:
--
--     CREATE ROLE app_rw LOGIN PASSWORD 'change_in_production';
--     GRANT CONNECT ON DATABASE datto_rmm TO app_rw;
--     GRANT USAGE ON SCHEMA public TO app_rw;
--     GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rw;
--     GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rw;
--     -- Remove UPDATE/DELETE on audit_logs at the privilege level too (belt + suspenders)
--     REVOKE UPDATE, DELETE ON audit_logs FROM app_rw;
--
--   Then set DATABASE_URL=postgresql://app_rw:...@pgbouncer:5432/datto_rmm
--   in all service env vars (auth-service, ai-service).
--   Run migrations with the postgres superuser only.

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

-- Policy: allow INSERT (all sessions may write audit events)
CREATE POLICY audit_logs_insert ON audit_logs
  AS PERMISSIVE
  FOR INSERT
  WITH CHECK (true);

-- Policy: allow SELECT (all sessions may read audit events)
CREATE POLICY audit_logs_select ON audit_logs
  AS PERMISSIVE
  FOR SELECT
  USING (true);

-- No UPDATE or DELETE policies — RLS denies these by default.
-- Even if an attacker gains app_rw access they cannot modify audit history.

-- Security-definer helper for write tool audit events.
-- Called from application code instead of a direct INSERT so the write path
-- is clearly separated from normal query code and easy to audit.
-- SECURITY DEFINER runs as the function owner (postgres), ensuring it can
-- always insert regardless of the calling role.
CREATE OR REPLACE FUNCTION append_audit_event(
  p_user_id     uuid,
  p_event_type  text,
  p_tool_name   text        DEFAULT NULL,
  p_ip_address  text        DEFAULT NULL,
  p_metadata    jsonb       DEFAULT '{}'
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  INSERT INTO audit_logs (user_id, event_type, tool_name, ip_address, metadata)
  VALUES (p_user_id, p_event_type, p_tool_name, p_ip_address, p_metadata);
END;
$$;

-- Grant execute to app role (created above in production)
-- In dev, postgres runs everything so this is a no-op
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_rw') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION append_audit_event TO app_rw';
  END IF;
END
$$;
