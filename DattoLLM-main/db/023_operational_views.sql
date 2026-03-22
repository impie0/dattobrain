-- 023_operational_views.sql — Operational views extracting hidden data from JSONB fields
-- These views surface security, compliance, and operational data that exists in the
-- raw Datto API responses but isn't in dedicated columns.

-- ── Encryption & TPM Status (from UDF2) ─────────────────────────────────────
-- UDF2 contains BitLocker/TPM audit results: "TPM: Active [Modern: v2.x] | DISKS: C:ENCOK"

CREATE OR REPLACE VIEW v_encryption_status AS
SELECT
  d.uid,
  d.hostname,
  d.site_name,
  d.operating_system,
  d.online,
  d.data->'udf'->>'udf2' AS raw_udf2,
  CASE
    WHEN d.data->'udf'->>'udf2' LIKE '%ENCOK%' THEN 'Encrypted'
    WHEN d.data->'udf'->>'udf2' LIKE '%ENCFAIL%' THEN 'Not Encrypted'
    WHEN d.data->'udf'->>'udf2' IS NULL OR d.data->'udf'->>'udf2' = '' THEN 'No Data'
    ELSE 'Unknown'
  END AS bitlocker_status,
  CASE
    WHEN d.data->'udf'->>'udf2' LIKE '%Modern: v2%' THEN 'TPM 2.0'
    WHEN d.data->'udf'->>'udf2' LIKE '%Legacy: v1%' THEN 'TPM 1.2'
    WHEN d.data->'udf'->>'udf2' LIKE '%Absent%' THEN 'No TPM'
    WHEN d.data->'udf'->>'udf2' IS NULL OR d.data->'udf'->>'udf2' = '' THEN 'No Data'
    ELSE 'Unknown'
  END AS tpm_status
FROM datto_cache_devices d;

-- ── Patch Compliance (from device data) ─────────────────────────────────────

CREATE OR REPLACE VIEW v_patch_compliance AS
SELECT
  d.uid,
  d.hostname,
  d.site_name,
  d.operating_system,
  d.online,
  d.data->'patchManagement'->>'patchStatus' AS patch_status,
  (d.data->'patchManagement'->>'patchesInstalled')::int AS patches_installed,
  (d.data->'patchManagement'->>'patchesApprovedPending')::int AS patches_pending,
  (d.data->'patchManagement'->>'patchesNotApproved')::int AS patches_not_approved,
  d.reboot_required
FROM datto_cache_devices d
WHERE d.data->'patchManagement'->>'patchStatus' IS NOT NULL;

-- ── Patch Compliance Summary (per site) ─────────────────────────────────────

CREATE OR REPLACE VIEW v_patch_compliance_by_site AS
SELECT
  d.site_name,
  COUNT(*) AS total_devices,
  COUNT(*) FILTER (WHERE d.data->'patchManagement'->>'patchStatus' = 'FullyPatched') AS fully_patched,
  COUNT(*) FILTER (WHERE d.data->'patchManagement'->>'patchStatus' = 'ApprovedPending') AS patches_pending,
  COUNT(*) FILTER (WHERE d.data->'patchManagement'->>'patchStatus' = 'RebootRequired') AS reboot_needed,
  COUNT(*) FILTER (WHERE d.data->'patchManagement'->>'patchStatus' = 'InstallError') AS install_errors,
  COUNT(*) FILTER (WHERE d.data->'patchManagement'->>'patchStatus' = 'NoPolicy') AS no_policy,
  COUNT(*) FILTER (WHERE d.data->'patchManagement'->>'patchStatus' = 'NoData') AS no_data,
  ROUND(
    COUNT(*) FILTER (WHERE d.data->'patchManagement'->>'patchStatus' = 'FullyPatched')::numeric
    / NULLIF(COUNT(*), 0) * 100
  ) AS compliance_pct
FROM datto_cache_devices d
WHERE d.data->'patchManagement'->>'patchStatus' IS NOT NULL
GROUP BY d.site_name;

-- ── Disk Space Warnings (from alert context) ────────────────────────────────

CREATE OR REPLACE VIEW v_disk_space_warnings AS
SELECT
  a.data->'alertSourceInfo'->>'deviceName' AS device_name,
  a.data->'alertSourceInfo'->>'siteName' AS site_name,
  a.data->'alertSourceInfo'->>'deviceUid' AS device_uid,
  a.data->'alertContext'->>'diskName' AS disk,
  ROUND((a.data->'alertContext'->>'freeSpace')::numeric / 1024) AS free_mb,
  ROUND((a.data->'alertContext'->>'totalVolume')::numeric / 1024) AS total_mb,
  CASE
    WHEN (a.data->'alertContext'->>'totalVolume')::numeric > 0
    THEN ROUND((a.data->'alertContext'->>'freeSpace')::numeric / (a.data->'alertContext'->>'totalVolume')::numeric * 100, 1)
    ELSE 0
  END AS free_pct,
  a.priority,
  a.alert_timestamp
FROM datto_cache_alerts a
WHERE a.data->'alertContext'->>'@class' = 'perf_disk_usage_ctx'
  AND NOT a.resolved;

-- ── Security Threats (from alert context) ───────────────────────────────────

CREATE OR REPLACE VIEW v_security_threats AS
SELECT
  a.alert_uid,
  a.data->'alertSourceInfo'->>'deviceName' AS device_name,
  a.data->'alertSourceInfo'->>'siteName' AS site_name,
  a.data->'alertSourceInfo'->>'deviceUid' AS device_uid,
  a.data->'alertContext'->>'threatName' AS threat_name,
  a.data->'alertContext'->>'threatPath' AS threat_path,
  a.data->'alertContext'->>'threatType' AS threat_type,
  a.priority,
  a.resolved,
  a.alert_timestamp
FROM datto_cache_alerts a
WHERE a.data->'alertContext'->>'@class' = 'endpoint_security_threat_ctx';

-- ── Offline Devices (from alert context) ────────────────────────────────────

CREATE OR REPLACE VIEW v_offline_alerts AS
SELECT
  a.data->'alertSourceInfo'->>'deviceName' AS device_name,
  a.data->'alertSourceInfo'->>'siteName' AS site_name,
  a.data->'alertSourceInfo'->>'deviceUid' AS device_uid,
  a.alert_timestamp,
  NOW() - a.alert_timestamp AS offline_duration
FROM datto_cache_alerts a
WHERE a.data->'alertContext'->>'@class' = 'online_offline_status_ctx'
  AND NOT a.resolved
ORDER BY a.alert_timestamp ASC;

-- ── Service Status Alerts ───────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_service_alerts AS
SELECT
  a.data->'alertSourceInfo'->>'deviceName' AS device_name,
  a.data->'alertSourceInfo'->>'siteName' AS site_name,
  a.data->'alertContext'->>'serviceName' AS service_name,
  a.data->'alertContext'->>'status' AS service_status,
  a.priority,
  a.resolved,
  a.alert_timestamp
FROM datto_cache_alerts a
WHERE a.data->'alertContext'->>'@class' = 'srvc_status_ctx';

-- ── Server Roles (from UDF4) ────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_server_roles AS
SELECT
  d.uid,
  d.hostname,
  d.site_name,
  d.operating_system,
  d.online,
  d.data->'udf'->>'udf4' AS raw_roles,
  d.data->'udf'->>'udf4' LIKE '%SQL%' AS is_sql_server,
  d.data->'udf'->>'udf4' LIKE '%IIS%' AS is_web_server,
  d.data->'udf'->>'udf4' LIKE '%RDS%' AS is_rds_server,
  d.data->'udf'->>'udf4' LIKE '%HyperV%' AS is_hyperv_host,
  d.data->'udf'->>'udf4' LIKE '%DNS%' AS is_dns_server,
  d.data->'udf'->>'udf4' LIKE '%ADC%' OR d.data->'udf'->>'udf4' LIKE '%PDC%' AS is_domain_controller,
  d.data->'udf'->>'udf4' LIKE '%Print%' AS is_print_server,
  d.data->'udf'->>'udf4' LIKE '%File%' AS is_file_server,
  d.data->'udf'->>'udf4' LIKE '%Veeam%' AS is_backup_server
FROM datto_cache_devices d
WHERE d.data->'udf'->>'udf4' IS NOT NULL
  AND LENGTH(d.data->'udf'->>'udf4') > 2;

-- ── Device Remote Access URLs ───────────────────────────────────────────────

CREATE OR REPLACE VIEW v_device_remote_access AS
SELECT
  d.uid,
  d.hostname,
  d.site_name,
  d.online,
  d.data->>'webRemoteUrl' AS remote_url,
  d.data->>'portalUrl' AS portal_url
FROM datto_cache_devices d
WHERE d.data->>'webRemoteUrl' IS NOT NULL;

-- ── Encryption Summary (per site) ───────────────────────────────────────────

CREATE OR REPLACE VIEW v_encryption_by_site AS
SELECT
  d.site_name,
  COUNT(*) AS total_devices,
  COUNT(*) FILTER (WHERE d.data->'udf'->>'udf2' LIKE '%ENCOK%') AS encrypted,
  COUNT(*) FILTER (WHERE d.data->'udf'->>'udf2' LIKE '%ENCFAIL%') AS not_encrypted,
  COUNT(*) FILTER (WHERE d.data->'udf'->>'udf2' LIKE '%Absent%') AS no_tpm,
  COUNT(*) FILTER (WHERE d.data->'udf'->>'udf2' IS NULL OR d.data->'udf'->>'udf2' = '') AS no_data,
  ROUND(
    COUNT(*) FILTER (WHERE d.data->'udf'->>'udf2' LIKE '%ENCOK%')::numeric
    / NULLIF(COUNT(*) FILTER (WHERE d.data->'udf'->>'udf2' IS NOT NULL AND d.data->'udf'->>'udf2' != ''), 0) * 100
  ) AS encryption_pct
FROM datto_cache_devices d
GROUP BY d.site_name;

-- ── Fleet Overview (single-row summary of everything) ───────────────────────

CREATE OR REPLACE VIEW v_fleet_overview AS
SELECT
  (SELECT COUNT(*) FROM datto_cache_sites) AS total_sites,
  (SELECT COUNT(*) FROM datto_cache_devices) AS total_devices,
  (SELECT COUNT(*) FROM datto_cache_devices WHERE online) AS online_devices,
  (SELECT COUNT(*) FROM datto_cache_devices WHERE NOT online) AS offline_devices,
  (SELECT COUNT(*) FROM datto_cache_alerts WHERE NOT resolved) AS open_alerts,
  (SELECT COUNT(*) FROM datto_cache_alerts WHERE NOT resolved AND priority = 'Critical') AS critical_alerts,
  (SELECT COUNT(*) FROM datto_cache_device_software) AS software_entries,
  (SELECT COUNT(*) FROM datto_cache_device_audit) AS audited_devices,
  (SELECT COUNT(DISTINCT device_uid) FROM device_vulnerabilities) AS vuln_affected_devices,
  (SELECT COUNT(DISTINCT cve_id) FROM device_vulnerabilities) AS unique_cves,
  (SELECT COUNT(*) FROM device_vulnerabilities WHERE severity = 'CRITICAL') AS critical_vulns,
  (SELECT COUNT(*) FROM datto_cache_devices WHERE data->'patchManagement'->>'patchStatus' = 'FullyPatched') AS fully_patched,
  (SELECT COUNT(*) FROM datto_cache_devices WHERE data->'patchManagement'->>'patchStatus' = 'NoPolicy') AS no_patch_policy,
  (SELECT COUNT(*) FROM datto_cache_devices WHERE data->'udf'->>'udf2' LIKE '%ENCOK%') AS encrypted_devices,
  (SELECT COUNT(*) FROM datto_cache_devices WHERE data->'udf'->>'udf2' LIKE '%ENCFAIL%') AS unencrypted_devices;
