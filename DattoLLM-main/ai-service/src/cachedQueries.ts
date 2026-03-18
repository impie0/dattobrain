/**
 * Cached query handlers — one per MCP tool that has a cacheable equivalent.
 * Each function queries the local datto_cache_* tables instead of calling the live API.
 * The AI receives the same JSON shape it would get from a live tool call.
 */

import type { Pool } from "pg";

const CACHED_NOTE = (syncedAt: string | null) =>
  `\n\n[Data from local cache — last synced: ${syncedAt ?? "unknown"}]`;

// SEC-012: Alert data is time-critical. Warn the LLM when alert cache is > 30 minutes old
// so it can communicate staleness to the user rather than presenting stale data as current.
const ALERT_CACHED_NOTE = (syncedAt: string | null): string => {
  if (!syncedAt) return `\n\n[Alert data from local cache — last synced: unknown. Data may be stale.]`;
  const ageMs = Date.now() - new Date(syncedAt).getTime();
  const ageMin = Math.round(ageMs / 60_000);
  const staleness = ageMs > 30 * 60_000
    ? ` WARNING: alert data is ${ageMin} minutes old — may not reflect current device status.`
    : ` (${ageMin} min ago)`;
  return `\n\n[Alert data from local cache — last synced: ${syncedAt}.${staleness}]`;
};

function latestSync(rows: { synced_at?: Date }[]): string | null {
  if (!rows.length) return null;
  const d = rows[0]?.synced_at;
  return d ? new Date(d).toISOString() : null;
}

// ── Account ────────────────────────────────────────────────────────────────

export async function cachedGetAccount(db: Pool): Promise<string> {
  const r = await db.query(`SELECT data, synced_at FROM datto_cache_account LIMIT 1`);
  if (!r.rows.length) return JSON.stringify({ error: "No cached account data. Run a sync first." });
  const row = r.rows[0] as { data: unknown; synced_at: Date };
  return JSON.stringify(row.data) + CACHED_NOTE(new Date(row.synced_at).toISOString());
}

export async function cachedListUsers(db: Pool): Promise<string> {
  const r = await db.query(`SELECT data, synced_at FROM datto_cache_users ORDER BY email`);
  const synced = latestSync(r.rows as { synced_at: Date }[]);
  const result = { users: r.rows.map((row: { data: unknown }) => row.data), pageDetails: { count: r.rowCount, totalCount: r.rowCount, totalPages: 1 } };
  return JSON.stringify(result) + CACHED_NOTE(synced);
}

export async function cachedListAccountVariables(db: Pool): Promise<string> {
  const r = await db.query(`SELECT id, name, CASE WHEN masked THEN '****' ELSE value END AS value, masked, synced_at FROM datto_cache_account_variables ORDER BY name`);
  const synced = latestSync(r.rows as { synced_at: Date }[]);
  return JSON.stringify({ variables: r.rows }) + CACHED_NOTE(synced);
}

export async function cachedListComponents(db: Pool): Promise<string> {
  const r = await db.query(`SELECT data, synced_at FROM datto_cache_components ORDER BY name`);
  const synced = latestSync(r.rows as { synced_at: Date }[]);
  return JSON.stringify({ components: r.rows.map((row: { data: unknown }) => row.data) }) + CACHED_NOTE(synced);
}

// ── Sites ──────────────────────────────────────────────────────────────────

export async function cachedListSites(db: Pool, args: Record<string, unknown>): Promise<string> {
  const page = Number(args["page"] ?? 1);
  const pageSize = Number(args["pageSize"] ?? 50);
  const offset = (page - 1) * pageSize;

  const r = await db.query(
    `SELECT data, synced_at FROM datto_cache_sites ORDER BY name LIMIT $1 OFFSET $2`,
    [pageSize, offset]
  );
  const total = await db.query(`SELECT COUNT(*) FROM datto_cache_sites`);
  const totalCount = Number((total.rows[0] as { count: string }).count);
  const synced = latestSync(r.rows as { synced_at: Date }[]);
  const result = {
    sites: r.rows.map((row: { data: unknown }) => row.data),
    pageDetails: { page, pageSize, count: r.rowCount, totalCount, totalPages: Math.ceil(totalCount / pageSize) },
  };
  return JSON.stringify(result) + CACHED_NOTE(synced);
}

export async function cachedGetSite(db: Pool, args: Record<string, unknown>): Promise<string> {
  const r = await db.query(
    `SELECT COALESCE(detail_data, data) AS data, synced_at FROM datto_cache_sites WHERE uid = $1`,
    [args["siteUid"]]
  );
  if (!r.rows.length) return JSON.stringify({ error: `Site ${args["siteUid"]} not found in cache` });
  const row = r.rows[0] as { data: unknown; synced_at: Date };
  return JSON.stringify(row.data) + CACHED_NOTE(new Date(row.synced_at).toISOString());
}

export async function cachedGetSiteSettings(db: Pool, args: Record<string, unknown>): Promise<string> {
  const r = await db.query(`SELECT settings_data, synced_at FROM datto_cache_sites WHERE uid = $1`, [args["siteUid"]]);
  if (!r.rows.length || !(r.rows[0] as { settings_data: unknown }).settings_data) {
    return JSON.stringify({ error: `Site settings for ${args["siteUid"]} not found in cache` });
  }
  const row = r.rows[0] as { settings_data: unknown; synced_at: Date };
  return JSON.stringify(row.settings_data) + CACHED_NOTE(new Date(row.synced_at).toISOString());
}

export async function cachedGetSiteVariables(db: Pool, args: Record<string, unknown>): Promise<string> {
  const r = await db.query(
    `SELECT id, name, CASE WHEN masked THEN '****' ELSE value END AS value, masked, synced_at FROM datto_cache_site_variables WHERE site_uid = $1 ORDER BY name`,
    [args["siteUid"]]
  );
  const synced = latestSync(r.rows as { synced_at: Date }[]);
  return JSON.stringify({ variables: r.rows, siteUid: args["siteUid"] }) + CACHED_NOTE(synced);
}

export async function cachedListSiteDevices(db: Pool, args: Record<string, unknown>): Promise<string> {
  const r = await db.query(
    `SELECT data, synced_at FROM datto_cache_devices WHERE site_uid = $1 ORDER BY hostname`,
    [args["siteUid"]]
  );
  const synced = latestSync(r.rows as { synced_at: Date }[]);
  return JSON.stringify({ devices: r.rows.map((row: { data: unknown }) => row.data), count: r.rowCount }) + CACHED_NOTE(synced);
}

export async function cachedListSiteOpenAlerts(db: Pool, args: Record<string, unknown>): Promise<string> {
  const r = await db.query(
    `SELECT data, synced_at FROM datto_cache_alerts WHERE site_uid = $1 AND resolved = false ORDER BY alert_timestamp DESC`,
    [args["siteUid"]]
  );
  const synced = latestSync(r.rows as { synced_at: Date }[]);
  return JSON.stringify({ alerts: r.rows.map((row: { data: unknown }) => row.data), count: r.rowCount }) + ALERT_CACHED_NOTE(synced);
}

// ── Devices ────────────────────────────────────────────────────────────────

export async function cachedListDevices(db: Pool, args: Record<string, unknown>): Promise<string> {
  const page = Number(args["page"] ?? 1);
  const pageSize = Number(args["pageSize"] ?? 50);
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const params: unknown[] = [pageSize, offset];
  let pi = 3;

  if (args["siteUid"]) { conditions.push(`site_uid = $${pi++}`); params.push(args["siteUid"]); }
  if (args["hostname"]) { conditions.push(`hostname ILIKE $${pi++}`); params.push(`%${args["hostname"]}%`); }
  if (args["online"] !== undefined) { conditions.push(`online = $${pi++}`); params.push(args["online"]); }
  if (args["deviceClass"]) { conditions.push(`device_class = $${pi++}`); params.push(args["deviceClass"]); }
  if (args["operatingSystem"]) { conditions.push(`operating_system ILIKE $${pi++}`); params.push(`%${args["operatingSystem"]}%`); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const r = await db.query(`SELECT data, synced_at FROM datto_cache_devices ${where} ORDER BY hostname LIMIT $1 OFFSET $2`, params);
  const totalQ = await db.query(`SELECT COUNT(*) FROM datto_cache_devices ${where}`, params.slice(2));
  const totalCount = Number((totalQ.rows[0] as { count: string }).count);
  const synced = latestSync(r.rows as { synced_at: Date }[]);
  return JSON.stringify({
    devices: r.rows.map((row: { data: unknown }) => row.data),
    pageDetails: { page, pageSize, count: r.rowCount, totalCount, totalPages: Math.ceil(totalCount / pageSize) },
  }) + CACHED_NOTE(synced);
}

export async function cachedGetDevice(db: Pool, args: Record<string, unknown>): Promise<string> {
  const r = await db.query(`SELECT data, synced_at FROM datto_cache_devices WHERE uid = $1`, [args["deviceUid"]]);
  if (!r.rows.length) return JSON.stringify({ error: `Device ${args["deviceUid"]} not found in cache` });
  const row = r.rows[0] as { data: unknown; synced_at: Date };
  return JSON.stringify(row.data) + CACHED_NOTE(new Date(row.synced_at).toISOString());
}

export async function cachedGetDeviceByMac(db: Pool, args: Record<string, unknown>): Promise<string> {
  const r = await db.query(
    `SELECT data, synced_at FROM datto_cache_devices WHERE data->>'macAddress' = $1 LIMIT 1`,
    [args["macAddress"]]
  );
  if (!r.rows.length) return JSON.stringify({ error: `Device with MAC ${args["macAddress"]} not found in cache` });
  const row = r.rows[0] as { data: unknown; synced_at: Date };
  return JSON.stringify(row.data) + CACHED_NOTE(new Date(row.synced_at).toISOString());
}

export async function cachedGetDeviceAudit(db: Pool, args: Record<string, unknown>): Promise<string> {
  const r = await db.query(`SELECT data, synced_at FROM datto_cache_device_audit WHERE device_uid = $1`, [args["deviceUid"]]);
  if (!r.rows.length) return JSON.stringify({ error: `Audit data for device ${args["deviceUid"]} not in cache` });
  const row = r.rows[0] as { data: unknown; synced_at: Date };
  return JSON.stringify(row.data) + CACHED_NOTE(new Date(row.synced_at).toISOString());
}

export async function cachedGetDeviceAuditByMac(db: Pool, args: Record<string, unknown>): Promise<string> {
  const r = await db.query(
    `SELECT a.data, a.synced_at FROM datto_cache_device_audit a
     JOIN datto_cache_devices d ON d.uid = a.device_uid
     WHERE d.data->>'macAddress' = $1 LIMIT 1`,
    [args["macAddress"]]
  );
  if (!r.rows.length) return JSON.stringify({ error: `Audit data for MAC ${args["macAddress"]} not in cache` });
  const row = r.rows[0] as { data: unknown; synced_at: Date };
  return JSON.stringify(row.data) + CACHED_NOTE(new Date(row.synced_at).toISOString());
}

export async function cachedGetDeviceSoftware(db: Pool, args: Record<string, unknown>): Promise<string> {
  const r = await db.query(
    `SELECT name, version, publisher, install_date, synced_at FROM datto_cache_device_software WHERE device_uid = $1 ORDER BY name`,
    [args["deviceUid"]]
  );
  const synced = latestSync(r.rows as { synced_at: Date }[]);
  return JSON.stringify({ software: r.rows, count: r.rowCount }) + CACHED_NOTE(synced);
}

export async function cachedGetEsxiAudit(db: Pool, args: Record<string, unknown>): Promise<string> {
  const r = await db.query(`SELECT data, synced_at FROM datto_cache_esxi_audit WHERE device_uid = $1`, [args["deviceUid"]]);
  if (!r.rows.length) return JSON.stringify({ error: `ESXi audit for device ${args["deviceUid"]} not in cache` });
  const row = r.rows[0] as { data: unknown; synced_at: Date };
  return JSON.stringify(row.data) + CACHED_NOTE(new Date(row.synced_at).toISOString());
}

export async function cachedGetPrinterAudit(db: Pool, args: Record<string, unknown>): Promise<string> {
  const r = await db.query(`SELECT data, synced_at FROM datto_cache_printer_audit WHERE device_uid = $1`, [args["deviceUid"]]);
  if (!r.rows.length) return JSON.stringify({ error: `Printer audit for device ${args["deviceUid"]} not in cache` });
  const row = r.rows[0] as { data: unknown; synced_at: Date };
  return JSON.stringify(row.data) + CACHED_NOTE(new Date(row.synced_at).toISOString());
}

// ── Alerts ─────────────────────────────────────────────────────────────────

export async function cachedListOpenAlerts(db: Pool, args: Record<string, unknown>): Promise<string> {
  const page = Number(args["page"] ?? 1);
  const pageSize = Number(args["pageSize"] ?? 50);
  const offset = (page - 1) * pageSize;
  const r = await db.query(
    `SELECT data, synced_at FROM datto_cache_alerts WHERE resolved = false ORDER BY alert_timestamp DESC LIMIT $1 OFFSET $2`,
    [pageSize, offset]
  );
  const total = await db.query(`SELECT COUNT(*) FROM datto_cache_alerts WHERE resolved = false`);
  const totalCount = Number((total.rows[0] as { count: string }).count);
  const synced = latestSync(r.rows as { synced_at: Date }[]);
  return JSON.stringify({
    alerts: r.rows.map((row: { data: unknown }) => row.data),
    pageDetails: { page, pageSize, count: r.rowCount, totalCount, totalPages: Math.ceil(totalCount / pageSize) },
  }) + ALERT_CACHED_NOTE(synced);
}

export async function cachedListResolvedAlerts(db: Pool, args: Record<string, unknown>): Promise<string> {
  const page = Number(args["page"] ?? 1);
  const pageSize = Number(args["pageSize"] ?? 50);
  const offset = (page - 1) * pageSize;
  const r = await db.query(
    `SELECT data, synced_at FROM datto_cache_alerts WHERE resolved = true ORDER BY resolved_at DESC LIMIT $1 OFFSET $2`,
    [pageSize, offset]
  );
  const total = await db.query(`SELECT COUNT(*) FROM datto_cache_alerts WHERE resolved = true`);
  const totalCount = Number((total.rows[0] as { count: string }).count);
  const synced = latestSync(r.rows as { synced_at: Date }[]);
  return JSON.stringify({
    alerts: r.rows.map((row: { data: unknown }) => row.data),
    pageDetails: { page, pageSize, count: r.rowCount, totalCount, totalPages: Math.ceil(totalCount / pageSize) },
  }) + ALERT_CACHED_NOTE(synced);
}

export async function cachedGetAlert(db: Pool, args: Record<string, unknown>): Promise<string> {
  const r = await db.query(`SELECT data, synced_at FROM datto_cache_alerts WHERE alert_uid = $1`, [args["alertUid"]]);
  if (!r.rows.length) return JSON.stringify({ error: `Alert ${args["alertUid"]} not found in cache` });
  const row = r.rows[0] as { data: unknown; synced_at: Date };
  return JSON.stringify(row.data) + ALERT_CACHED_NOTE(new Date(row.synced_at).toISOString());
}

// ── Filters ────────────────────────────────────────────────────────────────

export async function cachedListDefaultFilters(db: Pool): Promise<string> {
  const r = await db.query(`SELECT data, synced_at FROM datto_cache_filters WHERE filter_type = 'default' ORDER BY name`);
  const synced = latestSync(r.rows as { synced_at: Date }[]);
  return JSON.stringify({ filters: r.rows.map((row: { data: unknown }) => row.data) }) + CACHED_NOTE(synced);
}

export async function cachedListCustomFilters(db: Pool): Promise<string> {
  const r = await db.query(`SELECT data, synced_at FROM datto_cache_filters WHERE filter_type = 'custom' ORDER BY name`);
  const synced = latestSync(r.rows as { synced_at: Date }[]);
  return JSON.stringify({ filters: r.rows.map((row: { data: unknown }) => row.data) }) + CACHED_NOTE(synced);
}

// ── Router — pick cached or live ───────────────────────────────────────────

/** Tools that are always live — never cached */
const LIVE_ONLY_TOOLS = new Set([
  "get-job", "get-job-components", "get-job-results", "get-job-stdout", "get-job-stderr",
  "get-activity-logs", "get-system-status", "get-rate-limit", "get-pagination-config",
]);

export function isLiveOnlyTool(toolName: string): boolean {
  return LIVE_ONLY_TOOLS.has(toolName);
}

/**
 * Execute a tool against the local cache.
 * Returns the result string (same format as MCP bridge result).
 * Throws if the tool is not cacheable.
 */
export async function executeCachedTool(
  toolName: string,
  args: Record<string, unknown>,
  db: Pool
): Promise<string> {
  switch (toolName) {
    // Account
    case "get-account":             return cachedGetAccount(db);
    case "list-users":              return cachedListUsers(db);
    case "list-account-variables":  return cachedListAccountVariables(db);
    case "list-components":         return cachedListComponents(db);

    // Sites
    case "list-sites":              return cachedListSites(db, args);
    case "get-site":                return cachedGetSite(db, args);
    case "get-site-settings":       return cachedGetSiteSettings(db, args);
    case "get-site-variables":      return cachedGetSiteVariables(db, args);
    case "list-site-devices":       return cachedListSiteDevices(db, args);
    case "list-site-open-alerts":   return cachedListSiteOpenAlerts(db, args);

    // Devices
    case "list-devices":            return cachedListDevices(db, args);
    case "get-device":              return cachedGetDevice(db, args);
    case "get-device-by-mac":       return cachedGetDeviceByMac(db, args);
    case "get-device-audit":        return cachedGetDeviceAudit(db, args);
    case "get-device-audit-by-mac": return cachedGetDeviceAuditByMac(db, args);
    case "get-device-software":     return cachedGetDeviceSoftware(db, args);
    case "get-esxi-audit":          return cachedGetEsxiAudit(db, args);
    case "get-printer-audit":       return cachedGetPrinterAudit(db, args);

    // Alerts
    case "list-open-alerts":        return cachedListOpenAlerts(db, args);
    case "list-resolved-alerts":    return cachedListResolvedAlerts(db, args);
    case "get-alert":               return cachedGetAlert(db, args);

    // Filters
    case "list-default-filters":    return cachedListDefaultFilters(db);
    case "list-custom-filters":     return cachedListCustomFilters(db);

    default:
      throw new Error(`Tool "${toolName}" has no cached equivalent`);
  }
}
