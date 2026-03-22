-- 021_data_improvements.sql — Add missing device columns + useful views
-- Adds columns discovered from actual Datto API responses that aren't being extracted

-- ── New device columns (data available but not extracted) ────────────────────
ALTER TABLE datto_cache_devices ADD COLUMN IF NOT EXISTS domain text;
ALTER TABLE datto_cache_devices ADD COLUMN IF NOT EXISTS last_logged_in_user text;
ALTER TABLE datto_cache_devices ADD COLUMN IF NOT EXISTS last_reboot timestamptz;
ALTER TABLE datto_cache_devices ADD COLUMN IF NOT EXISTS last_audit_date timestamptz;
ALTER TABLE datto_cache_devices ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE datto_cache_devices ADD COLUMN IF NOT EXISTS suspended boolean DEFAULT false;
ALTER TABLE datto_cache_devices ADD COLUMN IF NOT EXISTS category text;

-- ── Indexes for common queries ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON datto_cache_devices(last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_devices_domain ON datto_cache_devices(domain);
CREATE INDEX IF NOT EXISTS idx_devices_suspended ON datto_cache_devices(suspended);
CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON datto_cache_alerts(alert_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_software_name_trgm ON datto_cache_device_software USING gin (name gin_trgm_ops);

-- ── Useful views ────────────────────────────────────────────────────────────

-- Site health summary — devices, online/offline, alert counts per site
CREATE OR REPLACE VIEW v_site_health AS
SELECT
  s.uid, s.name,
  COUNT(DISTINCT d.uid) AS total_devices,
  COUNT(DISTINCT d.uid) FILTER (WHERE d.online) AS online_devices,
  COUNT(DISTINCT d.uid) FILTER (WHERE NOT d.online) AS offline_devices,
  COUNT(DISTINCT a.alert_uid) FILTER (WHERE NOT a.resolved AND a.priority = 'Critical') AS critical_alerts,
  COUNT(DISTINCT a.alert_uid) FILTER (WHERE NOT a.resolved AND a.priority = 'High') AS high_alerts,
  COUNT(DISTINCT a.alert_uid) FILTER (WHERE NOT a.resolved) AS open_alerts,
  ROUND(COUNT(DISTINCT d.uid) FILTER (WHERE d.online)::numeric / NULLIF(COUNT(DISTINCT d.uid), 0) * 100) AS online_pct
FROM datto_cache_sites s
LEFT JOIN datto_cache_devices d ON d.site_uid = s.uid
LEFT JOIN datto_cache_alerts a ON a.site_uid = s.uid
GROUP BY s.uid, s.name;

-- Device health dashboard — key metrics per device
CREATE OR REPLACE VIEW v_device_health AS
SELECT
  d.uid, d.hostname, d.site_name, d.operating_system, d.online,
  d.last_seen, d.reboot_required, d.av_status, d.patch_status,
  d.last_logged_in_user, d.domain, d.suspended,
  da.cpu_description, da.cpu_cores, da.ram_total_mb,
  da.total_storage_gb, da.free_storage_gb,
  CASE WHEN da.total_storage_gb > 0
    THEN ROUND((da.free_storage_gb::numeric / da.total_storage_gb) * 100)
    ELSE NULL
  END AS free_disk_pct,
  (SELECT COUNT(*) FROM datto_cache_alerts a WHERE a.device_uid = d.uid AND NOT a.resolved) AS open_alerts,
  (SELECT COUNT(*) FROM datto_cache_device_software sw WHERE sw.device_uid = d.uid) AS software_count
FROM datto_cache_devices d
LEFT JOIN datto_cache_device_audit da ON da.device_uid = d.uid;

-- OS distribution — counts by OS family
CREATE OR REPLACE VIEW v_os_distribution AS
SELECT
  CASE
    WHEN operating_system ILIKE '%windows 11%' THEN 'Windows 11'
    WHEN operating_system ILIKE '%windows 10%' THEN 'Windows 10'
    WHEN operating_system ILIKE '%server 2025%' THEN 'Server 2025'
    WHEN operating_system ILIKE '%server 2022%' THEN 'Server 2022'
    WHEN operating_system ILIKE '%server 2019%' THEN 'Server 2019'
    WHEN operating_system ILIKE '%server 2016%' THEN 'Server 2016'
    WHEN operating_system ILIKE '%server 2012%' THEN 'Server 2012'
    WHEN operating_system ILIKE '%server 2008%' THEN 'Server 2008'
    WHEN operating_system ILIKE '%mac%' THEN 'macOS'
    WHEN operating_system ILIKE '%linux%' OR operating_system ILIKE '%ubuntu%' THEN 'Linux'
    ELSE COALESCE(LEFT(operating_system, 30), 'Unknown')
  END AS os_family,
  COUNT(*) AS device_count,
  SUM(CASE WHEN online THEN 1 ELSE 0 END) AS online_count
FROM datto_cache_devices
GROUP BY os_family
ORDER BY device_count DESC;

-- Software audit — which software is installed across the fleet
CREATE OR REPLACE VIEW v_software_audit AS
SELECT
  name,
  COUNT(DISTINCT device_uid) AS device_count,
  COUNT(DISTINCT version) AS version_count,
  MIN(version) AS min_version,
  MAX(version) AS max_version
FROM datto_cache_device_software
GROUP BY name;

-- Alert summary — open alerts grouped by type and priority
CREATE OR REPLACE VIEW v_alert_summary AS
SELECT
  priority,
  data->'alertContext'->>'@class' AS alert_type,
  COUNT(*) AS alert_count,
  COUNT(DISTINCT data->'alertSourceInfo'->>'siteUid') AS affected_sites,
  COUNT(DISTINCT data->'alertSourceInfo'->>'deviceUid') AS affected_devices
FROM datto_cache_alerts
WHERE NOT resolved
GROUP BY priority, data->'alertContext'->>'@class'
ORDER BY
  CASE priority WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Moderate' THEN 3 ELSE 4 END,
  alert_count DESC;

-- Stale devices — not seen in 7+ days
CREATE OR REPLACE VIEW v_stale_devices AS
SELECT
  d.uid, d.hostname, d.site_name, d.operating_system,
  d.last_seen,
  EXTRACT(DAY FROM NOW() - d.last_seen) AS days_since_seen,
  d.last_logged_in_user
FROM datto_cache_devices d
WHERE d.last_seen < NOW() - INTERVAL '7 days' AND d.last_seen IS NOT NULL
ORDER BY d.last_seen ASC;

-- Disk space warnings — devices with < 20% free space
CREATE OR REPLACE VIEW v_low_disk AS
SELECT
  d.hostname, d.site_name, d.online,
  da.total_storage_gb, da.free_storage_gb,
  ROUND((da.free_storage_gb::numeric / NULLIF(da.total_storage_gb, 0)) * 100) AS free_pct
FROM datto_cache_devices d
JOIN datto_cache_device_audit da ON da.device_uid = d.uid
WHERE da.total_storage_gb > 0
  AND da.free_storage_gb::numeric / NULLIF(da.total_storage_gb, 0) < 0.20
ORDER BY da.free_storage_gb::numeric / NULLIF(da.total_storage_gb, 0) ASC;
