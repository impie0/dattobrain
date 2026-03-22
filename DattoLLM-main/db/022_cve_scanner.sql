-- 022_cve_scanner.sql — Local CVE vulnerability scanner tables and views
-- Stores NVD CVE data locally, matches against datto_cache_device_software

-- ── CVE Database (NVD mirror) ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cve_database (
  cve_id              text PRIMARY KEY,              -- CVE-2024-12345
  description         text,
  cvss_v3_score       numeric(3,1),                  -- 0.0 .. 10.0
  cvss_v3_vector      text,                          -- CVSS:3.1/AV:N/AC:L/...
  severity            text,                          -- Critical|High|Medium|Low
  published_date      timestamptz,
  updated_date        timestamptz,
  reference_urls      jsonb DEFAULT '[]',             -- Array of reference URLs
  indexed_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cve_severity ON cve_database(severity);
CREATE INDEX IF NOT EXISTS idx_cve_published ON cve_database(published_date DESC);
CREATE INDEX IF NOT EXISTS idx_cve_score ON cve_database(cvss_v3_score DESC);

-- ── CPE Dictionary (CVE → software product mapping) ────────────────────────

CREATE TABLE IF NOT EXISTS cpe_dictionary (
  id                  bigserial PRIMARY KEY,
  cve_id              text NOT NULL REFERENCES cve_database(cve_id) ON DELETE CASCADE,
  vendor              text NOT NULL,                  -- microsoft
  product             text NOT NULL,                  -- edge
  version_start_incl  text,                          -- 120.0 (inclusive start)
  version_start_excl  text,                          -- exclusive start
  version_end_incl    text,                          -- inclusive end
  version_end_excl    text,                          -- exclusive end
  indexed_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cpe_vendor_product ON cpe_dictionary(vendor, product);
CREATE INDEX IF NOT EXISTS idx_cpe_cve ON cpe_dictionary(cve_id);

-- ── Device Vulnerabilities (matched results) ────────────────────────────────

CREATE TABLE IF NOT EXISTS device_vulnerabilities (
  id                  bigserial PRIMARY KEY,
  device_uid          text NOT NULL REFERENCES datto_cache_devices(uid) ON DELETE CASCADE,
  software_name       text NOT NULL,
  software_version    text,
  cve_id              text NOT NULL REFERENCES cve_database(cve_id) ON DELETE CASCADE,
  cpe_vendor          text NOT NULL,
  cpe_product         text NOT NULL,
  match_confidence    numeric(3,2) NOT NULL,          -- 0.50 .. 1.00
  cvss_score          numeric(3,1),
  severity            text,                          -- Critical|High|Medium|Low
  found_at            timestamptz DEFAULT now(),
  UNIQUE(device_uid, software_name, cve_id)
);

CREATE INDEX IF NOT EXISTS idx_vuln_device ON device_vulnerabilities(device_uid);
CREATE INDEX IF NOT EXISTS idx_vuln_severity ON device_vulnerabilities(severity);
CREATE INDEX IF NOT EXISTS idx_vuln_device_severity ON device_vulnerabilities(device_uid, severity);
CREATE INDEX IF NOT EXISTS idx_vuln_cve ON device_vulnerabilities(cve_id);
CREATE INDEX IF NOT EXISTS idx_vuln_software ON device_vulnerabilities(software_name);

-- ── CVE Sync Log ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cve_sync_log (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  started_at          timestamptz DEFAULT now(),
  completed_at        timestamptz,
  status              text NOT NULL DEFAULT 'running',  -- running|completed|failed
  phase               text DEFAULT 'download',          -- download|index|match
  cves_added          integer DEFAULT 0,
  cves_updated        integer DEFAULT 0,
  cpes_indexed        integer DEFAULT 0,
  matches_found       integer DEFAULT 0,
  error               text
);

CREATE INDEX IF NOT EXISTS idx_cve_sync_status ON cve_sync_log(status, started_at DESC);

-- ── Views ───────────────────────────────────────────────────────────────────

-- Per-device vulnerability summary
CREATE OR REPLACE VIEW v_device_vuln_summary AS
SELECT
  d.uid, d.hostname, d.site_name, d.online,
  COUNT(DISTINCT v.cve_id) AS total_cves,
  COUNT(DISTINCT v.cve_id) FILTER (WHERE v.severity = 'Critical') AS critical,
  COUNT(DISTINCT v.cve_id) FILTER (WHERE v.severity = 'High') AS high,
  COUNT(DISTINCT v.cve_id) FILTER (WHERE v.severity = 'Medium') AS medium,
  COUNT(DISTINCT v.cve_id) FILTER (WHERE v.severity = 'Low') AS low,
  MAX(v.cvss_score) AS worst_score
FROM datto_cache_devices d
LEFT JOIN device_vulnerabilities v ON v.device_uid = d.uid
GROUP BY d.uid, d.hostname, d.site_name, d.online;

-- Per-site vulnerability summary
CREATE OR REPLACE VIEW v_site_vuln_summary AS
SELECT
  d.site_uid, d.site_name,
  COUNT(DISTINCT d.uid) AS total_devices,
  COUNT(DISTINCT d.uid) FILTER (WHERE v.severity = 'Critical') AS devices_critical,
  COUNT(DISTINCT d.uid) FILTER (WHERE v.severity = 'High') AS devices_high,
  COUNT(DISTINCT v.cve_id) AS total_cves,
  COUNT(DISTINCT v.cve_id) FILTER (WHERE v.severity = 'Critical') AS critical_cves,
  COUNT(DISTINCT v.cve_id) FILTER (WHERE v.severity = 'High') AS high_cves,
  MAX(v.cvss_score) AS worst_score
FROM datto_cache_devices d
LEFT JOIN device_vulnerabilities v ON v.device_uid = d.uid
GROUP BY d.site_uid, d.site_name;

-- Most vulnerable software across fleet
CREATE OR REPLACE VIEW v_software_vuln_ranking AS
SELECT
  v.software_name,
  COUNT(DISTINCT v.cve_id) AS cve_count,
  COUNT(DISTINCT v.device_uid) AS affected_devices,
  MAX(v.cvss_score) AS worst_score,
  MAX(v.severity) AS worst_severity,
  array_agg(DISTINCT v.cve_id ORDER BY v.cve_id) FILTER (WHERE v.severity = 'Critical') AS critical_cves
FROM device_vulnerabilities v
GROUP BY v.software_name
ORDER BY worst_score DESC, cve_count DESC;
