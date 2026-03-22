-- Stage 3: Materialized views for instant LLM answers
-- These pre-compute summaries that would otherwise require multiple tool calls.
-- Refreshed after each sync via REFRESH MATERIALIZED VIEW CONCURRENTLY.

-- 1. Fleet operational status — single row, everything at a glance (~250 tokens)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_fleet_status AS
SELECT
  (SELECT COUNT(*) FROM datto_cache_devices) AS total_devices,
  (SELECT COUNT(*) FILTER (WHERE online) FROM datto_cache_devices) AS online_devices,
  (SELECT COUNT(*) FILTER (WHERE NOT online) FROM datto_cache_devices) AS offline_devices,
  (SELECT COUNT(*) FROM datto_cache_sites) AS total_sites,
  (SELECT COUNT(*) FROM datto_cache_alerts WHERE NOT resolved) AS open_alerts,
  (SELECT COUNT(*) FROM datto_cache_alerts WHERE resolved) AS resolved_alerts,
  (SELECT COUNT(DISTINCT device_uid) FROM datto_cache_device_audit) AS audited_devices,
  (SELECT COUNT(*) FROM datto_cache_device_software) AS total_software_installs,
  (SELECT MAX(synced_at) FROM datto_cache_devices) AS last_device_sync,
  (SELECT MAX(synced_at) FROM datto_cache_alerts) AS last_alert_sync,
  NOW() AS refreshed_at;

CREATE UNIQUE INDEX IF NOT EXISTS mv_fleet_status_idx ON mv_fleet_status (refreshed_at);

-- 2. Site summary — per-site health metrics (~200 bytes per site, ~18K for 89 sites)
-- NOTE: Uses subqueries instead of JOINs to avoid cross-product inflation
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_site_summary AS
SELECT
  s.uid AS site_uid,
  s.name AS site_name,
  (SELECT COUNT(*) FROM datto_cache_devices d WHERE d.site_uid = s.uid) AS device_count,
  (SELECT COUNT(*) FILTER (WHERE d.online) FROM datto_cache_devices d WHERE d.site_uid = s.uid) AS online_count,
  (SELECT COUNT(*) FILTER (WHERE NOT d.online) FROM datto_cache_devices d WHERE d.site_uid = s.uid) AS offline_count,
  (SELECT COUNT(*) FROM datto_cache_alerts a WHERE a.site_uid = s.uid AND NOT a.resolved) AS open_alert_count,
  MAX(s.synced_at) AS last_sync
FROM datto_cache_sites s
GROUP BY s.uid, s.name
ORDER BY s.name;

CREATE UNIQUE INDEX IF NOT EXISTS mv_site_summary_uid_idx ON mv_site_summary (site_uid);

-- 3. Critical alerts — top 20 highest-priority open alerts (~1.5K tokens)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_critical_alerts AS
SELECT
  a.alert_uid,
  a.device_uid,
  d.hostname,
  s.name AS site_name,
  a.priority,
  a.alert_message,
  a.alert_timestamp
FROM datto_cache_alerts a
LEFT JOIN datto_cache_devices d ON d.uid = a.device_uid
LEFT JOIN datto_cache_sites s ON s.uid = a.site_uid
WHERE NOT a.resolved
ORDER BY
  CASE a.priority
    WHEN 'Critical' THEN 1
    WHEN 'High' THEN 2
    WHEN 'Moderate' THEN 3
    WHEN 'Low' THEN 4
    WHEN 'Information' THEN 5
    ELSE 6
  END,
  a.alert_timestamp DESC
LIMIT 20;

CREATE UNIQUE INDEX IF NOT EXISTS mv_critical_alerts_uid_idx ON mv_critical_alerts (alert_uid);

-- 4. OS distribution — compact breakdown (~500 bytes)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_os_distribution AS
SELECT
  operating_system,
  COUNT(*) AS device_count,
  COUNT(*) FILTER (WHERE online) AS online_count,
  ROUND(100.0 * COUNT(*) / NULLIF((SELECT COUNT(*) FROM datto_cache_devices), 0), 1) AS percentage
FROM datto_cache_devices
WHERE operating_system IS NOT NULL AND operating_system != ''
GROUP BY operating_system
ORDER BY device_count DESC;

CREATE UNIQUE INDEX IF NOT EXISTS mv_os_distribution_idx ON mv_os_distribution (operating_system);

-- 5. Alert priority breakdown — compact summary
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_alert_priority AS
SELECT
  priority,
  COUNT(*) AS alert_count,
  COUNT(DISTINCT device_uid) AS affected_devices,
  COUNT(DISTINCT site_uid) AS affected_sites
FROM datto_cache_alerts
WHERE NOT resolved
GROUP BY priority
ORDER BY
  CASE priority
    WHEN 'Critical' THEN 1
    WHEN 'High' THEN 2
    WHEN 'Moderate' THEN 3
    WHEN 'Low' THEN 4
    WHEN 'Information' THEN 5
    ELSE 6
  END;

CREATE UNIQUE INDEX IF NOT EXISTS mv_alert_priority_idx ON mv_alert_priority (priority);
