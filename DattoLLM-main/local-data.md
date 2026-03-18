# Local Data — Datto Cache Architecture

> Status: Design only — no code built yet
> Purpose: Pull Datto RMM data into local PostgreSQL on a schedule. AI queries local DB instead of calling Datto API live. A "Live" button bypasses the cache for real-time data.

---

## Core Principle

**The sync process has zero AI involvement.** It is plain TypeScript code that:
1. Calls the Datto API directly (via the existing MCP server endpoints)
2. Takes the raw JSON response
3. Writes it straight into PostgreSQL tables

No LLM, no token cost, no Claude. Just a data pipeline.

---

## Two Modes

```
CACHED MODE (default)
  AI reads from local PostgreSQL → fast, no Datto API call, no extra cost

LIVE MODE (on demand — user clicks "Live" button)
  AI calls Datto API via MCP in real time → current behaviour, always fresh
```

Cached data is stale by design. Use live mode when you need current data (e.g. checking if an alert was just resolved).

---

## What Gets Synced vs What Stays Live

### Synced to local cache

These are bulk-pullable via paginated list endpoints and change relatively slowly:

| Data | Datto API Endpoint | Sync frequency |
|---|---|---|
| Account summary | `GET /v2/account` | Daily |
| All sites | `GET /v2/account/sites` (paginated) | Daily |
| Site details | `GET /v2/site/{siteUid}` (per site) | Daily |
| Site settings | `GET /v2/site/{siteUid}/settings` (per site) | Daily |
| Site variables | `GET /v2/site/{siteUid}/variables` (per site) | Daily |
| Site filters | `GET /v2/site/{siteUid}/filters` (per site) | Daily |
| All devices | `GET /v2/account/devices` (paginated) | Daily |
| Device audit (hardware) | `GET /v2/audit/device/{deviceUid}` (per device, class=device) | Weekly |
| Device software | `GET /v2/audit/device/{deviceUid}/software` (per device, class=device) | Weekly |
| ESXi audit | `GET /v2/audit/esxihost/{deviceUid}` (per device, class=esxihost) | Weekly |
| Printer audit | `GET /v2/audit/printer/{deviceUid}` (per device, class=printer) | Weekly |
| Open alerts | `GET /v2/account/alerts/open` (paginated) | Every hour |
| Resolved alerts (last 7 days) | `GET /v2/account/alerts/resolved` (paginated) | Daily |
| Account users | `GET /v2/account/users` (paginated) | Daily |
| Account variables | `GET /v2/account/variables` (paginated) | Daily |
| Components | `GET /v2/account/components` (paginated) | Daily |
| Default filters | `GET /v2/account/filters/default` (paginated) | Daily |
| Custom filters | `GET /v2/account/filters/custom` (paginated) | Daily |

### Always live — never cached

These are real-time or require user-provided IDs that cannot be batch-pulled:

| Data | Reason |
|---|---|
| Jobs (`get-job`, `get-job-results`, etc.) | No list endpoint — user must provide jobUid from Datto portal |
| Job stdout / stderr | Same — requires specific jobUid + deviceUid |
| Activity logs | Real-time event stream, staleness defeats the purpose |
| `get-system-status` | System health check — must be live |
| `get-rate-limit` | Current rate limit state — must be live |
| `get-pagination-config` | Config — only needed at sync time, not for queries |

---

## Sync Order

Order matters — devices need siteUid, audits need deviceUid:

```
1. Account summary          (no dependencies)
2. Users                    (no dependencies)
3. Account variables        (no dependencies)
4. Components               (no dependencies)
5. Default filters          (no dependencies)
6. Custom filters           (no dependencies)
7. Sites (list all)         (no dependencies)
8. Site details             (depends on: sites list)
   Site settings            (depends on: sites list)
   Site variables           (depends on: sites list)
   Site filters             (depends on: sites list)
9. Devices (list all)       (depends on: sites list for siteUid)
10. Open alerts             (no dependencies — account-wide)
11. Resolved alerts         (no dependencies — account-wide)
12. Device audits           (depends on: devices list, only deviceClass='device')
    Device software         (depends on: devices list, only deviceClass='device')
    ESXi audits             (depends on: devices list, only deviceClass='esxihost')
    Printer audits          (depends on: devices list, only deviceClass='printer')
```

Steps 1–6 run in parallel. Steps 8, 11–12 run in parallel per-item batches.
Audit sync (step 12) is the slowest — one API call per device.

---

## Database Tables

All tables use a `data jsonb` column to store the full raw Datto API response alongside indexed fields for fast queries. This means the AI can always access any field even if it is not a named column.

---

### `datto_sync_log`

Tracks every sync run. One row per sync execution.

```sql
CREATE TABLE datto_sync_log (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  started_at      timestamptz DEFAULT now(),
  completed_at    timestamptz,
  triggered_by    text NOT NULL,            -- 'schedule' | 'manual'
  status          text NOT NULL DEFAULT 'running', -- 'running' | 'completed' | 'failed'
  error           text,

  -- Record counts per data type
  sites_synced          integer DEFAULT 0,
  devices_synced        integer DEFAULT 0,
  alerts_open_synced    integer DEFAULT 0,
  alerts_resolved_synced integer DEFAULT 0,
  users_synced          integer DEFAULT 0,
  device_audits_synced  integer DEFAULT 0,
  device_software_synced integer DEFAULT 0,
  esxi_audits_synced    integer DEFAULT 0,
  printer_audits_synced integer DEFAULT 0
);
```

---

### `datto_cache_account`

One row — the account summary. Replaced on every sync.

```sql
CREATE TABLE datto_cache_account (
  id              integer PRIMARY KEY,      -- Datto account numeric ID
  uid             text NOT NULL,            -- Datto account UID
  name            text NOT NULL,            -- Account / company name
  portal_url      text,                     -- e.g. https://xxx.centrastage.net
  device_count    integer,                  -- Total devices registered
  online_count    integer,                  -- Devices currently online
  offline_count   integer,                  -- Devices currently offline
  data            jsonb NOT NULL,           -- Full raw API response
  synced_at       timestamptz DEFAULT now()
);
```

**Source:** `GET /v2/account`

---

### `datto_cache_sites`

One row per site.

```sql
CREATE TABLE datto_cache_sites (
  uid                   text PRIMARY KEY,   -- Datto site UID
  id                    integer,            -- Datto site numeric ID
  name                  text NOT NULL,      -- Site name e.g. "London Office"
  description           text,
  on_demand             boolean,
  device_count          integer,            -- Total devices at site
  online_count          integer,            -- Online devices at site
  offline_count         integer,            -- Offline devices at site
  -- From get-site detail
  autotask_company_name text,
  autotask_company_id   text,
  -- From get-site-settings
  proxy_host            text,
  proxy_port            integer,
  proxy_type            text,
  -- Raw data
  data                  jsonb NOT NULL,     -- Full raw response from list-sites
  detail_data           jsonb,             -- Full raw response from get-site
  settings_data         jsonb,             -- Full raw response from get-site-settings
  synced_at             timestamptz DEFAULT now()
);

CREATE INDEX idx_datto_cache_sites_name ON datto_cache_sites (name);
```

**Sources:**
- `GET /v2/account/sites` — bulk list
- `GET /v2/site/{siteUid}` — per-site detail
- `GET /v2/site/{siteUid}/settings` — per-site settings

---

### `datto_cache_site_variables`

One row per variable per site.

```sql
CREATE TABLE datto_cache_site_variables (
  id        integer,
  site_uid  text NOT NULL REFERENCES datto_cache_sites(uid) ON DELETE CASCADE,
  name      text NOT NULL,
  value     text,
  masked    boolean DEFAULT false,
  synced_at timestamptz DEFAULT now(),
  PRIMARY KEY (site_uid, name)
);
```

**Source:** `GET /v2/site/{siteUid}/variables`

---

### `datto_cache_site_filters`

Device filters defined per site.

```sql
CREATE TABLE datto_cache_site_filters (
  id        integer,
  site_uid  text NOT NULL REFERENCES datto_cache_sites(uid) ON DELETE CASCADE,
  name      text NOT NULL,
  data      jsonb NOT NULL,
  synced_at timestamptz DEFAULT now(),
  PRIMARY KEY (site_uid, id)
);
```

**Source:** `GET /v2/site/{siteUid}/filters`

---

### `datto_cache_devices`

One row per device. The largest table.

```sql
CREATE TABLE datto_cache_devices (
  uid                 text PRIMARY KEY,     -- Datto device UID
  id                  integer,              -- Datto device numeric ID
  hostname            text NOT NULL,
  int_ip_address      text,                 -- Internal IP
  ext_ip_address      text,                 -- External / public IP
  site_uid            text REFERENCES datto_cache_sites(uid),
  site_name           text,
  device_class        text,                 -- 'device' | 'esxihost' | 'printer'
  device_type         text,                 -- e.g. 'Laptop', 'Server', 'Workstation'
  operating_system    text,                 -- e.g. 'Windows 10 Pro'
  display_version     text,                 -- e.g. '22H2'
  online              boolean,
  reboot_required     boolean,
  last_seen           timestamptz,
  warranty_date       text,
  -- Antivirus summary (from list-devices response)
  av_product          text,                 -- e.g. 'Windows Defender'
  av_status           text,                 -- e.g. 'active', 'inactive', 'expired'
  -- Patch summary
  patch_status        text,                 -- e.g. 'up_to_date', 'patches_available'
  -- User defined fields
  udf1  text, udf2  text, udf3  text, udf4  text, udf5  text,
  udf6  text, udf7  text, udf8  text, udf9  text, udf10 text,
  udf11 text, udf12 text, udf13 text, udf14 text, udf15 text,
  udf16 text, udf17 text, udf18 text, udf19 text, udf20 text,
  udf21 text, udf22 text, udf23 text, udf24 text, udf25 text,
  udf26 text, udf27 text, udf28 text, udf29 text, udf30 text,
  -- Raw data
  data                jsonb NOT NULL,       -- Full raw API response
  synced_at           timestamptz DEFAULT now()
);

CREATE INDEX idx_datto_cache_devices_hostname   ON datto_cache_devices (hostname);
CREATE INDEX idx_datto_cache_devices_site_uid   ON datto_cache_devices (site_uid);
CREATE INDEX idx_datto_cache_devices_online     ON datto_cache_devices (online);
CREATE INDEX idx_datto_cache_devices_device_class ON datto_cache_devices (device_class);
CREATE INDEX idx_datto_cache_devices_os         ON datto_cache_devices (operating_system);
```

**Source:** `GET /v2/account/devices` (paginated, max 250 per page)

---

### `datto_cache_device_audit`

Hardware audit — one row per device. Only for `device_class = 'device'`.

```sql
CREATE TABLE datto_cache_device_audit (
  device_uid          text PRIMARY KEY REFERENCES datto_cache_devices(uid) ON DELETE CASCADE,
  -- CPU
  cpu_description     text,                 -- e.g. 'Intel Core i7-12700K'
  cpu_cores           integer,
  cpu_processors      integer,
  cpu_speed_mhz       integer,
  -- Memory
  ram_total_mb        integer,              -- Total physical RAM in MB
  -- BIOS
  bios_manufacturer   text,
  bios_version        text,
  bios_release_date   text,
  -- OS
  os_name             text,
  os_build            text,
  os_install_date     text,
  -- Storage summary (drives stored in data jsonb)
  drive_count         integer,
  total_storage_gb    integer,
  free_storage_gb     integer,
  -- Network (NICs stored in data jsonb)
  nic_count           integer,
  -- Raw data
  data                jsonb NOT NULL,       -- Full raw audit response including drives[], networkCards[], monitors[], graphics[]
  synced_at           timestamptz DEFAULT now()
);
```

**Source:** `GET /v2/audit/device/{deviceUid}`

---

### `datto_cache_device_software`

Installed software — one row per software title per device.

```sql
CREATE TABLE datto_cache_device_software (
  id              bigserial PRIMARY KEY,
  device_uid      text NOT NULL REFERENCES datto_cache_devices(uid) ON DELETE CASCADE,
  name            text NOT NULL,
  version         text,
  publisher       text,
  install_date    text,
  synced_at       timestamptz DEFAULT now()
);

CREATE INDEX idx_datto_cache_software_device ON datto_cache_device_software (device_uid);
CREATE INDEX idx_datto_cache_software_name   ON datto_cache_device_software (name);
```

**Source:** `GET /v2/audit/device/{deviceUid}/software`

> Note: This table can grow very large. A single device may have 100–300 software entries. With 3,000 devices that is 300,000–900,000 rows. Weekly sync recommended.

---

### `datto_cache_esxi_audit`

ESXi host audit. One row per ESXi host device.

```sql
CREATE TABLE datto_cache_esxi_audit (
  device_uid      text PRIMARY KEY REFERENCES datto_cache_devices(uid) ON DELETE CASCADE,
  vm_count        integer,
  datastore_count integer,
  data            jsonb NOT NULL,           -- Full raw audit including vms[], datastores[], hosts[]
  synced_at       timestamptz DEFAULT now()
);
```

**Source:** `GET /v2/audit/esxihost/{deviceUid}`

---

### `datto_cache_printer_audit`

Printer audit with supply levels. One row per printer device.

```sql
CREATE TABLE datto_cache_printer_audit (
  device_uid          text PRIMARY KEY REFERENCES datto_cache_devices(uid) ON DELETE CASCADE,
  model               text,
  -- Supply levels (stored as integers 0–100 representing percentage)
  toner_black_pct     integer,
  toner_cyan_pct      integer,
  toner_magenta_pct   integer,
  toner_yellow_pct    integer,
  drum_pct            integer,
  page_count          integer,
  data                jsonb NOT NULL,
  synced_at           timestamptz DEFAULT now()
);
```

**Source:** `GET /v2/audit/printer/{deviceUid}`

---

### `datto_cache_alerts`

Open and recent resolved alerts. Replaces existing rows on each sync using `alert_uid` as the key.

```sql
CREATE TABLE datto_cache_alerts (
  alert_uid       text PRIMARY KEY,         -- Datto alert UID
  device_uid      text,                     -- Device the alert belongs to (nullable — some alerts are site-level)
  device_name     text,
  site_uid        text,
  site_name       text,
  alert_message   text NOT NULL,
  priority        text,                     -- e.g. 'Critical', 'High', 'Moderate', 'Low', 'Information'
  resolved        boolean DEFAULT false,
  muted           boolean DEFAULT false,
  alert_timestamp timestamptz,              -- When the alert was raised
  resolved_at     timestamptz,              -- When resolved (null if still open)
  autotask_ticket text,
  data            jsonb NOT NULL,
  synced_at       timestamptz DEFAULT now()
);

CREATE INDEX idx_datto_cache_alerts_device_uid ON datto_cache_alerts (device_uid);
CREATE INDEX idx_datto_cache_alerts_site_uid   ON datto_cache_alerts (site_uid);
CREATE INDEX idx_datto_cache_alerts_resolved   ON datto_cache_alerts (resolved);
CREATE INDEX idx_datto_cache_alerts_priority   ON datto_cache_alerts (priority);
```

**Sources:**
- `GET /v2/account/alerts/open` — all open alerts (synced every hour)
- `GET /v2/account/alerts/resolved` — resolved alerts, last 7 days (synced daily)

---

### `datto_cache_users`

Datto RMM portal users. Not the same as platform users in the `users` table.

> Note: Datto user objects have no `uid` field, so `email` is the primary key (migration 009 recreated this table with email as PK).

```sql
CREATE TABLE datto_cache_users (
  email       text PRIMARY KEY,             -- Datto users have no uid; email is the unique key
  first_name  text,
  last_name   text,
  role        text,                         -- Datto portal role e.g. 'Admin', 'User'
  last_login  timestamptz,
  data        jsonb NOT NULL,
  synced_at   timestamptz DEFAULT now()
);
```

**Source:** `GET /v2/account/users`

---

### `datto_cache_account_variables`

Account-level variables. Masked values are stored as `****`.

```sql
CREATE TABLE datto_cache_account_variables (
  id        integer PRIMARY KEY,
  name      text NOT NULL,
  value     text,                           -- Stored as '****' if masked=true
  masked    boolean DEFAULT false,
  synced_at timestamptz DEFAULT now()
);
```

**Source:** `GET /v2/account/variables`

---

### `datto_cache_components`

Job components available in the account.

```sql
CREATE TABLE datto_cache_components (
  uid         text PRIMARY KEY,
  id          integer,
  name        text NOT NULL,
  category    text,
  component_type text,
  data        jsonb NOT NULL,
  synced_at   timestamptz DEFAULT now()
);
```

**Source:** `GET /v2/account/components`

---

### `datto_cache_filters`

Default and custom device filters.

```sql
CREATE TABLE datto_cache_filters (
  id          integer PRIMARY KEY,
  name        text NOT NULL,
  filter_type text NOT NULL,               -- 'default' | 'custom'
  data        jsonb NOT NULL,
  synced_at   timestamptz DEFAULT now()
);
```

**Sources:**
- `GET /v2/account/filters/default`
- `GET /v2/account/filters/custom`

---

## Sync Schedule

Configured in `datto_sync_schedule` table or hardcoded in the sync service:

| Sync type | Default schedule | Rationale |
|---|---|---|
| Full sync (all data) | Daily at 02:00 UTC | Low-traffic window |
| Alerts only | Every hour | Alerts change frequently |
| Manual sync | On demand (admin button) | Immediate refresh |

---

## Admin Panel — Data Sync Page

New page at `/admin/data-sync`:

```
Last full sync:    2026-03-16 02:00 UTC  ✅ Completed in 4m 32s
Last alert sync:   2026-03-16 13:00 UTC  ✅ Completed in 8s

Record counts:
  Sites:            142
  Devices:          3,847
    ↳ Audited:      3,612  (devices only)
    ↳ Software:     3,612  (weekly)
    ↳ ESXi hosts:   14
    ↳ Printers:     63
  Open alerts:      23
  Resolved (7d):    1,204
  Users:            18
  Components:       94
  Filters:          12 default / 8 custom

Schedule:
  Full sync:   [ Daily at 02:00 UTC  ▼ ]
  Alerts:      [ Every hour          ▼ ]
  [ Save schedule ]

[ Sync Now — Full ]   [ Sync Now — Alerts Only ]
```

---

## Chat UI — Live Toggle

A toggle in the chat input bar:

```
[ Cached ●─── Live ]
```

- **Cached (default):** AI reads from `datto_cache_*` tables. Fast, no Datto API call.
- **Live:** AI calls Datto API via MCP in real time. Current behaviour.

The mode is stored per session in the `chat_sessions` table (new column: `data_mode text DEFAULT 'cached'`).

---

## What the AI Sees in Cached Mode

Instead of tool results coming from the Datto API, they come from SQL queries on the cache tables. The AI receives the same JSON format — it cannot tell the difference. Each cached response includes a note:

```
[Data from local cache — last synced: 2026-03-16 02:00 UTC]
```

This is appended to the tool result so the AI can inform the user if asked whether the data is live.

---

## Implementation Order

1. Create all `datto_cache_*` tables (migrations in `db/`)
2. Build sync service in `ai-service/src/sync.ts`
   - Paginated fetch functions for each data type
   - Upsert logic (INSERT ... ON CONFLICT DO UPDATE)
   - Writes to `datto_sync_log`
3. Add sync endpoints to `ai-service/src/index.ts`
   - `POST /api/admin/sync` — trigger manual sync
   - `GET /api/admin/sync/status` — current sync state + record counts
4. Build cached query handlers — one per tool that has a cached equivalent
5. Add mode switching logic to `legacyChat.ts` and `chat.ts`
6. Add "Data Sync" page to admin panel
7. Add "Live" toggle to chat UI
8. Add cron job inside ai-service for scheduled syncs
