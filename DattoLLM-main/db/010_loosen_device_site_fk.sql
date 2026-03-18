-- ============================================================
--  Migration 010 — Loosen device→site FK
--  Drop the hard FK constraint on datto_cache_devices.site_uid.
--  The logical link is preserved (site_uid column stays) but we
--  don't enforce it at DB level — a device whose site wasn't in
--  the sync batch would otherwise cause an FK violation and fail
--  the entire device sync.
-- ============================================================

ALTER TABLE datto_cache_devices DROP CONSTRAINT IF EXISTS datto_cache_devices_site_uid_fkey;
