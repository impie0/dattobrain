-- 024_extended_audit_data.sql — Extract hidden data from device audit JSONB into queryable tables/views
-- Phase 1: Surface GPU, RAM DIMMs, services, NIC details, and activity logs

-- ── Physical Memory / RAM DIMMs ─────────────────────────────────────────────
-- Each device may have multiple DIMM slots with type, speed, capacity, serial

CREATE TABLE IF NOT EXISTS datto_cache_device_memory (
  id              bigserial PRIMARY KEY,
  device_uid      text NOT NULL REFERENCES datto_cache_devices(uid) ON DELETE CASCADE,
  slot            text,              -- "DIMM1", "Physical Memory 0"
  capacity_bytes  bigint,            -- 4294967296 (4GB)
  capacity_gb     numeric(6,1) GENERATED ALWAYS AS (ROUND(capacity_bytes::numeric / 1073741824, 1)) STORED,
  memory_type     text,              -- DDR4, DDR5, null
  speed           text,              -- "2666", "3200"
  part_number     text,              -- "HMA851U6CJR6N-VK"
  serial_number   text,
  bank            text,              -- "Physical Memory 0"
  synced_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_memory_device ON datto_cache_device_memory(device_uid);

-- ── Video / GPU ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS datto_cache_device_gpu (
  id              bigserial PRIMARY KEY,
  device_uid      text NOT NULL REFERENCES datto_cache_devices(uid) ON DELETE CASCADE,
  display_adapter text NOT NULL,     -- "NVIDIA GeForce RTX 3060"
  synced_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_gpu_device ON datto_cache_device_gpu(device_uid);

-- ── Monitors / Displays ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS datto_cache_device_displays (
  id              bigserial PRIMARY KEY,
  device_uid      text NOT NULL REFERENCES datto_cache_devices(uid) ON DELETE CASCADE,
  name            text,
  manufacturer    text,
  serial_number   text,
  synced_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_displays_device ON datto_cache_device_displays(device_uid);

-- ── Network Interfaces (detailed) ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS datto_cache_device_nics (
  id              bigserial PRIMARY KEY,
  device_uid      text NOT NULL REFERENCES datto_cache_devices(uid) ON DELETE CASCADE,
  name            text,              -- "Realtek PCIe GbE Family Controller"
  type            text,              -- "Ethernet", "Wireless80211"
  ipv4            text,
  ipv6            text,
  mac_address     text,
  synced_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_nics_device ON datto_cache_device_nics(device_uid);
CREATE INDEX IF NOT EXISTS idx_device_nics_mac ON datto_cache_device_nics(mac_address);

-- ── Activity Logs ───────────────────────────────────────────────────────────
-- 180 days of user actions, remote sessions, patch deployments, device changes

CREATE TABLE IF NOT EXISTS datto_cache_activity_logs (
  id              text PRIMARY KEY,  -- Datto activity ID
  entity          text,              -- DEVICE, SITE, USER, etc.
  category        text,              -- patch, remote_session, device, user, etc.
  action          text,              -- audit, connect, create, delete, etc.
  activity_date   timestamptz,
  site_id         integer,
  site_name       text,
  device_id       integer,
  hostname        text,
  username        text,              -- Datto RMM user who performed the action
  details         jsonb,             -- Full activity details
  has_stdout      boolean DEFAULT false,
  has_stderr      boolean DEFAULT false,
  synced_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_date ON datto_cache_activity_logs(activity_date DESC);
CREATE INDEX IF NOT EXISTS idx_activity_category ON datto_cache_activity_logs(category, action);
CREATE INDEX IF NOT EXISTS idx_activity_device ON datto_cache_activity_logs(device_id);
CREATE INDEX IF NOT EXISTS idx_activity_hostname ON datto_cache_activity_logs(hostname);

-- ── Views for extracted data ────────────────────────────────────────────────

-- RAM summary per device
CREATE OR REPLACE VIEW v_device_memory AS
SELECT
  d.uid, d.hostname, d.site_name,
  COUNT(m.id) AS dimm_count,
  SUM(m.capacity_gb) AS total_ram_gb,
  MAX(m.speed) AS max_speed,
  string_agg(DISTINCT m.memory_type, ', ') FILTER (WHERE m.memory_type IS NOT NULL) AS memory_types,
  string_agg(m.slot || ': ' || COALESCE(m.capacity_gb::text, '?') || 'GB', ' | ' ORDER BY m.slot) AS slot_detail
FROM datto_cache_devices d
LEFT JOIN datto_cache_device_memory m ON m.device_uid = d.uid
GROUP BY d.uid, d.hostname, d.site_name;

-- GPU inventory
CREATE OR REPLACE VIEW v_gpu_inventory AS
SELECT
  g.display_adapter,
  COUNT(DISTINCT g.device_uid) AS device_count,
  array_agg(DISTINCT d.site_name) AS sites
FROM datto_cache_device_gpu g
JOIN datto_cache_devices d ON d.uid = g.device_uid
GROUP BY g.display_adapter
ORDER BY device_count DESC;

-- Network interface summary
CREATE OR REPLACE VIEW v_network_interfaces AS
SELECT
  d.uid, d.hostname, d.site_name,
  COUNT(n.id) AS nic_count,
  string_agg(n.type || ': ' || COALESCE(n.ipv4, 'no IP') || ' (' || COALESCE(n.mac_address, '?') || ')', ' | ') AS interfaces
FROM datto_cache_devices d
LEFT JOIN datto_cache_device_nics n ON n.device_uid = d.uid
GROUP BY d.uid, d.hostname, d.site_name;

-- Activity log summary by category
CREATE OR REPLACE VIEW v_activity_summary AS
SELECT
  category,
  action,
  COUNT(*) AS total_events,
  COUNT(*) FILTER (WHERE activity_date > NOW() - INTERVAL '24 hours') AS last_24h,
  COUNT(*) FILTER (WHERE activity_date > NOW() - INTERVAL '7 days') AS last_7d,
  COUNT(DISTINCT hostname) AS unique_devices,
  COUNT(DISTINCT username) AS unique_users
FROM datto_cache_activity_logs
GROUP BY category, action
ORDER BY total_events DESC;

-- Remote sessions (from activity logs)
CREATE OR REPLACE VIEW v_remote_sessions AS
SELECT
  hostname,
  site_name,
  username,
  activity_date,
  action,
  details->>'session_duration' AS duration
FROM datto_cache_activity_logs
WHERE category = 'remote_session'
ORDER BY activity_date DESC;
