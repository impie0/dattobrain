-- ============================================================
--  Migration 011 — Add error tracking columns to datto_sync_log
--  Surfaces per-device audit failures and last Datto API error.
-- ============================================================

ALTER TABLE datto_sync_log
  ADD COLUMN IF NOT EXISTS audit_errors   integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_api_error text;
