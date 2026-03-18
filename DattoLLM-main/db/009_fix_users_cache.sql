-- ============================================================
--  Migration 009 — Fix datto_cache_users
--  Datto portal users have no uid field — email is the PK.
--  Also adds missing columns from actual API response.
-- ============================================================

-- Drop and recreate — table was never successfully populated
-- (sync always failed on uid NOT NULL violation before this fix)
DROP TABLE IF EXISTS datto_cache_users CASCADE;

CREATE TABLE datto_cache_users (
  email       text PRIMARY KEY,
  username    text,
  first_name  text,
  last_name   text,
  telephone   text,
  status      text,
  last_access timestamptz,
  disabled    boolean,
  data        jsonb NOT NULL,
  synced_at   timestamptz DEFAULT now()
);
