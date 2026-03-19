-- Create the litellm database (used by LiteLLM gateway for internal tracking).
-- This runs against the default 'datto_rmm' DB but uses a DO block
-- to conditionally create the litellm DB via dblink-style exec.
-- PostgreSQL initdb scripts all run against the default DB.
SELECT 'CREATE DATABASE litellm'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'litellm')\gexec
