-- ============================================================
--  Migration 008 — Datto local data cache tables
--  Pulled from Datto API on a schedule; AI queries local DB
--  in cached mode instead of calling live API.
-- ============================================================

-- Sync run log
CREATE TABLE IF NOT EXISTS datto_sync_log (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  started_at              timestamptz DEFAULT now(),
  completed_at            timestamptz,
  triggered_by            text NOT NULL,            -- 'schedule' | 'manual'
  status                  text NOT NULL DEFAULT 'running', -- 'running' | 'completed' | 'failed'
  error                   text,
  sites_synced            integer DEFAULT 0,
  devices_synced          integer DEFAULT 0,
  alerts_open_synced      integer DEFAULT 0,
  alerts_resolved_synced  integer DEFAULT 0,
  users_synced            integer DEFAULT 0,
  device_audits_synced    integer DEFAULT 0,
  device_software_synced  integer DEFAULT 0,
  esxi_audits_synced      integer DEFAULT 0,
  printer_audits_synced   integer DEFAULT 0
);

-- Account summary (one row, replaced on every sync)
CREATE TABLE IF NOT EXISTS datto_cache_account (
  id            integer PRIMARY KEY,
  uid           text NOT NULL,
  name          text NOT NULL,
  portal_url    text,
  device_count  integer,
  online_count  integer,
  offline_count integer,
  data          jsonb NOT NULL,
  synced_at     timestamptz DEFAULT now()
);

-- Sites
CREATE TABLE IF NOT EXISTS datto_cache_sites (
  uid                   text PRIMARY KEY,
  id                    integer,
  name                  text NOT NULL,
  description           text,
  on_demand             boolean,
  device_count          integer,
  online_count          integer,
  offline_count         integer,
  autotask_company_name text,
  autotask_company_id   text,
  proxy_host            text,
  proxy_port            integer,
  proxy_type            text,
  data                  jsonb NOT NULL,
  detail_data           jsonb,
  settings_data         jsonb,
  synced_at             timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_datto_cache_sites_name ON datto_cache_sites (name);

-- Site variables
CREATE TABLE IF NOT EXISTS datto_cache_site_variables (
  id        integer,
  site_uid  text NOT NULL REFERENCES datto_cache_sites(uid) ON DELETE CASCADE,
  name      text NOT NULL,
  value     text,
  masked    boolean DEFAULT false,
  synced_at timestamptz DEFAULT now(),
  PRIMARY KEY (site_uid, name)
);

-- Site filters
CREATE TABLE IF NOT EXISTS datto_cache_site_filters (
  id        integer,
  site_uid  text NOT NULL REFERENCES datto_cache_sites(uid) ON DELETE CASCADE,
  name      text NOT NULL,
  data      jsonb NOT NULL,
  synced_at timestamptz DEFAULT now(),
  PRIMARY KEY (site_uid, id)
);

-- Devices (largest table)
CREATE TABLE IF NOT EXISTS datto_cache_devices (
  uid              text PRIMARY KEY,
  id               integer,
  hostname         text NOT NULL,
  int_ip_address   text,
  ext_ip_address   text,
  site_uid         text REFERENCES datto_cache_sites(uid),
  site_name        text,
  device_class     text,
  device_type      text,
  operating_system text,
  display_version  text,
  online           boolean,
  reboot_required  boolean,
  last_seen        timestamptz,
  warranty_date    text,
  av_product       text,
  av_status        text,
  patch_status     text,
  udf1  text, udf2  text, udf3  text, udf4  text, udf5  text,
  udf6  text, udf7  text, udf8  text, udf9  text, udf10 text,
  udf11 text, udf12 text, udf13 text, udf14 text, udf15 text,
  udf16 text, udf17 text, udf18 text, udf19 text, udf20 text,
  udf21 text, udf22 text, udf23 text, udf24 text, udf25 text,
  udf26 text, udf27 text, udf28 text, udf29 text, udf30 text,
  data             jsonb NOT NULL,
  synced_at        timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_datto_cache_devices_hostname     ON datto_cache_devices (hostname);
CREATE INDEX IF NOT EXISTS idx_datto_cache_devices_site_uid     ON datto_cache_devices (site_uid);
CREATE INDEX IF NOT EXISTS idx_datto_cache_devices_online       ON datto_cache_devices (online);
CREATE INDEX IF NOT EXISTS idx_datto_cache_devices_device_class ON datto_cache_devices (device_class);
CREATE INDEX IF NOT EXISTS idx_datto_cache_devices_os           ON datto_cache_devices (operating_system);

-- Device hardware audit
CREATE TABLE IF NOT EXISTS datto_cache_device_audit (
  device_uid        text PRIMARY KEY REFERENCES datto_cache_devices(uid) ON DELETE CASCADE,
  cpu_description   text,
  cpu_cores         integer,
  cpu_processors    integer,
  cpu_speed_mhz     integer,
  ram_total_mb      integer,
  bios_manufacturer text,
  bios_version      text,
  bios_release_date text,
  os_name           text,
  os_build          text,
  os_install_date   text,
  drive_count       integer,
  total_storage_gb  integer,
  free_storage_gb   integer,
  nic_count         integer,
  data              jsonb NOT NULL,
  synced_at         timestamptz DEFAULT now()
);

-- Device software (one row per software title per device)
CREATE TABLE IF NOT EXISTS datto_cache_device_software (
  id           bigserial PRIMARY KEY,
  device_uid   text NOT NULL REFERENCES datto_cache_devices(uid) ON DELETE CASCADE,
  name         text NOT NULL,
  version      text,
  publisher    text,
  install_date text,
  synced_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_datto_cache_software_device ON datto_cache_device_software (device_uid);
CREATE INDEX IF NOT EXISTS idx_datto_cache_software_name   ON datto_cache_device_software (name);

-- ESXi host audit
CREATE TABLE IF NOT EXISTS datto_cache_esxi_audit (
  device_uid      text PRIMARY KEY REFERENCES datto_cache_devices(uid) ON DELETE CASCADE,
  vm_count        integer,
  datastore_count integer,
  data            jsonb NOT NULL,
  synced_at       timestamptz DEFAULT now()
);

-- Printer audit
CREATE TABLE IF NOT EXISTS datto_cache_printer_audit (
  device_uid       text PRIMARY KEY REFERENCES datto_cache_devices(uid) ON DELETE CASCADE,
  model            text,
  toner_black_pct  integer,
  toner_cyan_pct   integer,
  toner_magenta_pct integer,
  toner_yellow_pct integer,
  drum_pct         integer,
  page_count       integer,
  data             jsonb NOT NULL,
  synced_at        timestamptz DEFAULT now()
);

-- Alerts (open + recent resolved)
CREATE TABLE IF NOT EXISTS datto_cache_alerts (
  alert_uid       text PRIMARY KEY,
  device_uid      text,
  device_name     text,
  site_uid        text,
  site_name       text,
  alert_message   text NOT NULL,
  priority        text,
  resolved        boolean DEFAULT false,
  muted           boolean DEFAULT false,
  alert_timestamp timestamptz,
  resolved_at     timestamptz,
  autotask_ticket text,
  data            jsonb NOT NULL,
  synced_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_datto_cache_alerts_device_uid ON datto_cache_alerts (device_uid);
CREATE INDEX IF NOT EXISTS idx_datto_cache_alerts_site_uid   ON datto_cache_alerts (site_uid);
CREATE INDEX IF NOT EXISTS idx_datto_cache_alerts_resolved   ON datto_cache_alerts (resolved);
CREATE INDEX IF NOT EXISTS idx_datto_cache_alerts_priority   ON datto_cache_alerts (priority);

-- Datto portal users (not platform users)
CREATE TABLE IF NOT EXISTS datto_cache_users (
  uid        text PRIMARY KEY,
  email      text NOT NULL,
  first_name text,
  last_name  text,
  role       text,
  last_login timestamptz,
  data       jsonb NOT NULL,
  synced_at  timestamptz DEFAULT now()
);

-- Account-level variables
CREATE TABLE IF NOT EXISTS datto_cache_account_variables (
  id        integer PRIMARY KEY,
  name      text NOT NULL,
  value     text,
  masked    boolean DEFAULT false,
  synced_at timestamptz DEFAULT now()
);

-- Job components
CREATE TABLE IF NOT EXISTS datto_cache_components (
  uid            text PRIMARY KEY,
  id             integer,
  name           text NOT NULL,
  category       text,
  component_type text,
  data           jsonb NOT NULL,
  synced_at      timestamptz DEFAULT now()
);

-- Default + custom device filters
CREATE TABLE IF NOT EXISTS datto_cache_filters (
  id          integer PRIMARY KEY,
  name        text NOT NULL,
  filter_type text NOT NULL,
  data        jsonb NOT NULL,
  synced_at   timestamptz DEFAULT now()
);

-- data_mode column on chat_sessions for cached vs live
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS data_mode text NOT NULL DEFAULT 'cached';
