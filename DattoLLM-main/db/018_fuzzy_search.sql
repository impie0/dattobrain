-- 018_fuzzy_search.sql — Enable pg_trgm for fuzzy text matching on cached data
-- Supports typo-tolerant site/device lookups (e.g. "rojlig" → "Rohlig")

-- Enable the trigram extension (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram index on site names — supports similarity() and ILIKE
CREATE INDEX IF NOT EXISTS idx_datto_cache_sites_name_trgm
  ON datto_cache_sites USING gin (name gin_trgm_ops);

-- GIN trigram index on device hostnames
CREATE INDEX IF NOT EXISTS idx_datto_cache_devices_hostname_trgm
  ON datto_cache_devices USING gin (hostname gin_trgm_ops);

-- GIN trigram index on device site_name (for list-devices siteName filter)
CREATE INDEX IF NOT EXISTS idx_datto_cache_devices_site_name_trgm
  ON datto_cache_devices USING gin (site_name gin_trgm_ops);
