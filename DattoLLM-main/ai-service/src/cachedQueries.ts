/**
 * Cached query handlers — one per MCP tool that has a cacheable equivalent.
 * Each function queries the local datto_cache_* tables instead of calling the live API.
 * The AI receives the same JSON shape it would get from a live tool call.
 */

import type { Pool } from "pg";
import { semanticSearch, semanticSearch as chatHistorySearch } from "./embeddings.js";

const CACHED_NOTE = (syncedAt: string | null) =>
  `\n\n[Data from local cache — last synced: ${syncedAt ?? "unknown"}]`;

/** Stage 2: Hard cap on tool result size — prevents context overflow from large results */
const MAX_RESULT_CHARS = 8_000;

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
  const siteName = typeof args["siteName"] === "string" ? args["siteName"].trim() : "";

  if (siteName) {
    // Step 1: Try exact ILIKE substring match
    const ilike = await db.query(
      `SELECT data, synced_at FROM datto_cache_sites WHERE name ILIKE $1 ORDER BY name LIMIT $2 OFFSET $3`,
      [`%${siteName}%`, pageSize, offset]
    );
    if (ilike.rows.length > 0) {
      const total = await db.query(`SELECT COUNT(*) FROM datto_cache_sites WHERE name ILIKE $1`, [`%${siteName}%`]);
      const totalCount = Number((total.rows[0] as { count: string }).count);
      const synced = latestSync(ilike.rows as { synced_at: Date }[]);
      return JSON.stringify({
        sites: ilike.rows.map((r: { data: unknown }) => r.data),
        pageDetails: { page, pageSize, count: ilike.rowCount, totalCount, totalPages: Math.ceil(totalCount / pageSize) },
      }) + CACHED_NOTE(synced);
    }

    // Step 2: Fuzzy fallback with pg_trgm (handles typos like "rojlig" → "Rohlig")
    const fuzzy = await db.query(
      `SELECT data, synced_at, similarity(name, $1) AS sim
       FROM datto_cache_sites
       WHERE similarity(name, $1) > 0.2
       ORDER BY sim DESC
       LIMIT $2 OFFSET $3`,
      [siteName, pageSize, offset]
    );
    if (fuzzy.rows.length > 0) {
      const total = await db.query(`SELECT COUNT(*) FROM datto_cache_sites WHERE similarity(name, $1) > 0.2`, [siteName]);
      const totalCount = Number((total.rows[0] as { count: string }).count);
      const synced = latestSync(fuzzy.rows as { synced_at: Date }[]);
      return JSON.stringify({
        sites: fuzzy.rows.map((r: { data: unknown }) => r.data),
        pageDetails: { page, pageSize, count: fuzzy.rowCount, totalCount, totalPages: Math.ceil(totalCount / pageSize) },
        _fuzzyMatch: true,
      }) + CACHED_NOTE(synced) + `\n[Fuzzy match — no exact match for "${siteName}"]`;
    }

    // Step 3: Nothing found
    return JSON.stringify({
      sites: [],
      pageDetails: { page, pageSize, count: 0, totalCount: 0, totalPages: 0 },
    }) + CACHED_NOTE(null) + `\n[No sites matching "${siteName}" found]`;
  }

  // No filter — return compact list with counts (Stage 2: keep under 8K)
  const r = await db.query(
    `SELECT s.uid, s.name, s.synced_at,
            (SELECT COUNT(*) FROM datto_cache_devices d WHERE d.site_uid = s.uid) AS device_count,
            (SELECT COUNT(*) FILTER (WHERE d.online) FROM datto_cache_devices d WHERE d.site_uid = s.uid) AS online_count
     FROM datto_cache_sites s ORDER BY s.name`
  );
  const total = r.rowCount ?? 0;
  const synced = latestSync(r.rows as { synced_at: Date }[]);
  const result = {
    totalSites: total,
    sites: r.rows.map((row: { uid: string; name: string; device_count: string; online_count: string }) => ({
      uid: row.uid, name: row.name,
      devices: Number(row.device_count), online: Number(row.online_count),
    })),
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
  const total = await db.query(`SELECT COUNT(*)::int AS count FROM datto_cache_devices WHERE site_uid = $1`, [args["siteUid"]]);
  const totalCount = Number((total.rows[0] as { count: number }).count);

  const DISPLAY_LIMIT = 10;
  const r = await db.query(
    `SELECT data, synced_at FROM datto_cache_devices WHERE site_uid = $1 ORDER BY hostname LIMIT ${DISPLAY_LIMIT}`,
    [args["siteUid"]]
  );
  const synced = latestSync(r.rows as { synced_at: Date }[]);
  // Put totalCount FIRST so it survives any truncation
  const result: Record<string, unknown> = {
    totalDevices: totalCount,
    showing: Math.min(DISPLAY_LIMIT, totalCount),
    devices: r.rows.map((row: { data: unknown }) => row.data),
  };
  if (totalCount > DISPLAY_LIMIT) {
    result.hint = `Showing ${DISPLAY_LIMIT} of ${totalCount} devices at this site. Use list-devices with hostname filter for specific devices.`;
  }
  return JSON.stringify(result) + CACHED_NOTE(synced);
}

export async function cachedListSiteOpenAlerts(db: Pool, args: Record<string, unknown>): Promise<string> {
  const total = await db.query(
    `SELECT COUNT(*)::int AS count FROM datto_cache_alerts WHERE site_uid = $1 AND resolved = false`,
    [args["siteUid"]]
  );
  const totalCount = Number((total.rows[0] as { count: number }).count);

  const DISPLAY_LIMIT = 5;
  const r = await db.query(
    `SELECT data, synced_at FROM datto_cache_alerts WHERE site_uid = $1 AND resolved = false ORDER BY alert_timestamp DESC LIMIT ${DISPLAY_LIMIT}`,
    [args["siteUid"]]
  );
  const synced = latestSync(r.rows as { synced_at: Date }[]);
  // Put totalCount FIRST so it survives any truncation
  const result: Record<string, unknown> = {
    totalOpenAlerts: totalCount,
    showing: Math.min(DISPLAY_LIMIT, totalCount),
    alerts: r.rows.map((row: { data: unknown }) => row.data),
  };
  if (totalCount > DISPLAY_LIMIT) {
    result.hint = `Showing ${DISPLAY_LIMIT} most recent of ${totalCount} open alerts at this site. Use list-device-open-alerts with a deviceUid for device-level alerts.`;
  }
  return JSON.stringify(result) + ALERT_CACHED_NOTE(synced);
}

// ── Devices ────────────────────────────────────────────────────────────────

export async function cachedListDevices(db: Pool, args: Record<string, unknown>): Promise<string> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let pi = 1;

  if (args["siteUid"]) { conditions.push(`site_uid = $${pi++}`); params.push(args["siteUid"]); }
  if (args["hostname"]) { conditions.push(`hostname ILIKE $${pi++}`); params.push(`%${args["hostname"]}%`); }
  if (args["online"] !== undefined) { conditions.push(`online = $${pi++}`); params.push(args["online"]); }
  if (args["deviceClass"]) { conditions.push(`device_class = $${pi++}`); params.push(args["deviceClass"]); }
  if (args["operatingSystem"]) { conditions.push(`operating_system ILIKE $${pi++}`); params.push(`%${args["operatingSystem"]}%`); }
  if (args["siteName"]) {
    const siteNameVal = String(args["siteName"]);
    conditions.push(`(site_name ILIKE $${pi} OR similarity(site_name, $${pi + 1}) > 0.2)`);
    params.push(`%${siteNameVal}%`, siteNameVal);
    pi += 2;
  }

  // Stage 2b: Block unfiltered list calls — prevents 150K+ token dumps
  if (conditions.length === 0) {
    const totals = await db.query(`
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE online) AS online,
             COUNT(*) FILTER (WHERE NOT online) AS offline
      FROM datto_cache_devices`);
    const t = totals.rows[0] as { total: string; online: string; offline: string };
    const osFacets = await db.query(`
      SELECT operating_system AS os, COUNT(*)::int AS count
      FROM datto_cache_devices GROUP BY operating_system ORDER BY count DESC LIMIT 8`);
    const synced = latestSync((await db.query(`SELECT synced_at FROM datto_cache_devices LIMIT 1`)).rows as { synced_at: Date }[]);
    return JSON.stringify({
      summary: { total: Number(t.total), online: Number(t.online), offline: Number(t.offline) },
      osFacets: osFacets.rows,
      hint: "Use filters to get device details: hostname, siteName, operatingSystem, deviceClass, or online (true/false). Example: list-devices with hostname='SERVER' or siteName='Main Office'.",
    }) + CACHED_NOTE(synced);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;
  const totalQ = await db.query(`SELECT COUNT(*) FROM datto_cache_devices ${where}`, params);
  const totalCount = Number((totalQ.rows[0] as { count: string }).count);

  // Stage 2a: Cap at 15 results — return facets for the rest
  const DISPLAY_LIMIT = 15;
  const r = await db.query(
    `SELECT data, synced_at FROM datto_cache_devices ${where} ORDER BY hostname LIMIT ${DISPLAY_LIMIT}`,
    params
  );
  const synced = latestSync(r.rows as { synced_at: Date }[]);
  // Put totalCount FIRST so it survives any truncation
  const result: Record<string, unknown> = {
    totalMatchingDevices: totalCount,
    showing: Math.min(DISPLAY_LIMIT, totalCount),
    devices: r.rows.map((row: { data: unknown }) => row.data),
  };
  if (totalCount > DISPLAY_LIMIT) {
    result.hint = `Showing ${DISPLAY_LIMIT} of ${totalCount} matching devices. Add more filters (hostname, siteName, operatingSystem) to narrow results.`;
  }
  return JSON.stringify(result) + CACHED_NOTE(synced);
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
  const total = await db.query(
    `SELECT COUNT(*)::int AS count FROM datto_cache_device_software WHERE device_uid = $1`,
    [args["deviceUid"]]
  );
  const totalCount = Number((total.rows[0] as { count: number }).count);

  // Stage 2a: Cap at 25 entries — most devices have 50-200 installed apps
  const DISPLAY_LIMIT = 25;
  const r = await db.query(
    `SELECT name, version, publisher, install_date, synced_at FROM datto_cache_device_software WHERE device_uid = $1 ORDER BY name LIMIT ${DISPLAY_LIMIT}`,
    [args["deviceUid"]]
  );
  const synced = latestSync(r.rows as { synced_at: Date }[]);
  const result: Record<string, unknown> = { software: r.rows, totalCount, showing: Math.min(DISPLAY_LIMIT, totalCount) };
  if (totalCount > DISPLAY_LIMIT) {
    result.hint = `Showing first ${DISPLAY_LIMIT} of ${totalCount} installed applications (alphabetical). The full list is available in the admin data browser.`;
  }
  return JSON.stringify(result) + CACHED_NOTE(synced);
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
  // Stage 2b: Return summary + top alerts instead of full dump
  const facets = await db.query(`
    SELECT priority, COUNT(*)::int AS count
    FROM datto_cache_alerts WHERE resolved = false
    GROUP BY priority ORDER BY count DESC`);
  const total = await db.query(`SELECT COUNT(*) FROM datto_cache_alerts WHERE resolved = false`);
  const totalCount = Number((total.rows[0] as { count: string }).count);

  // Stage 2a: Return top 5 most recent alerts + facets (keep well under 8K cap)
  const DISPLAY_LIMIT = 5;
  const r = await db.query(
    `SELECT data, synced_at FROM datto_cache_alerts WHERE resolved = false ORDER BY alert_timestamp DESC LIMIT ${DISPLAY_LIMIT}`
  );
  const synced = latestSync(r.rows as { synced_at: Date }[]);
  // Put summary fields FIRST so they survive any truncation
  const result: Record<string, unknown> = {
    totalOpenAlerts: totalCount,
    showing: Math.min(DISPLAY_LIMIT, totalCount),
    priorityBreakdown: facets.rows,
    alerts: r.rows.map((row: { data: unknown }) => row.data),
  };
  if (totalCount > DISPLAY_LIMIT) {
    result.hint = `Showing ${DISPLAY_LIMIT} most recent of ${totalCount} open alerts. Use list-site-open-alerts with a siteUid, or list-device-open-alerts with a deviceUid, to see alerts for a specific scope.`;
  }
  return JSON.stringify(result) + ALERT_CACHED_NOTE(synced);
}

export async function cachedListResolvedAlerts(db: Pool, args: Record<string, unknown>): Promise<string> {
  const total = await db.query(`SELECT COUNT(*) FROM datto_cache_alerts WHERE resolved = true`);
  const totalCount = Number((total.rows[0] as { count: string }).count);

  const DISPLAY_LIMIT = 5;
  const r = await db.query(
    `SELECT data, synced_at FROM datto_cache_alerts WHERE resolved = true ORDER BY resolved_at DESC LIMIT ${DISPLAY_LIMIT}`
  );
  const synced = latestSync(r.rows as { synced_at: Date }[]);
  const result: Record<string, unknown> = {
    totalResolvedAlerts: totalCount,
    showing: Math.min(DISPLAY_LIMIT, totalCount),
    alerts: r.rows.map((row: { data: unknown }) => row.data),
  };
  if (totalCount > DISPLAY_LIMIT) {
    result.hint = `Showing ${DISPLAY_LIMIT} most recently resolved of ${totalCount} total. Use list-site-resolved-alerts with a siteUid for site-scoped results.`;
  }
  return JSON.stringify(result) + ALERT_CACHED_NOTE(synced);
}

export async function cachedGetAlert(db: Pool, args: Record<string, unknown>): Promise<string> {
  const r = await db.query(`SELECT data, synced_at FROM datto_cache_alerts WHERE alert_uid = $1`, [args["alertUid"]]);
  if (!r.rows.length) return JSON.stringify({ error: `Alert ${args["alertUid"]} not found in cache` });
  const row = r.rows[0] as { data: unknown; synced_at: Date };
  return JSON.stringify(row.data) + ALERT_CACHED_NOTE(new Date(row.synced_at).toISOString());
}

// ── Materialized View tools (Stage 3) ─────────────────────────────────────

export async function cachedGetFleetStatus(db: Pool): Promise<string> {
  const r = await db.query(`SELECT * FROM mv_fleet_status LIMIT 1`);
  if (!r.rows.length) return JSON.stringify({ error: "Fleet status not available. Run a sync first." });
  const row = r.rows[0] as Record<string, unknown>;
  return JSON.stringify({
    totalDevices: row.total_devices,
    onlineDevices: row.online_devices,
    offlineDevices: row.offline_devices,
    totalSites: row.total_sites,
    openAlerts: row.open_alerts,
    resolvedAlerts: row.resolved_alerts,
    auditedDevices: row.audited_devices,
    totalSoftwareInstalls: row.total_software_installs,
    lastDeviceSync: row.last_device_sync,
    lastAlertSync: row.last_alert_sync,
    dataRefreshedAt: row.refreshed_at,
  });
}

export async function cachedListSiteSummaries(db: Pool): Promise<string> {
  const total = await db.query(`SELECT COUNT(*)::int AS count FROM mv_site_summary`);
  // Return compact rows — uid:name:devices:online:alerts — fits all 89 sites under 5K
  const r = await db.query(
    `SELECT site_uid, site_name, device_count::int, online_count::int, offline_count::int, open_alert_count::int
     FROM mv_site_summary ORDER BY open_alert_count DESC`
  );
  return JSON.stringify({
    totalSites: Number((total.rows[0] as { count: number }).count),
    sites: r.rows.map((row: Record<string, unknown>) => ({
      uid: row.site_uid,
      name: row.site_name,
      devices: row.device_count,
      online: row.online_count,
      alerts: row.open_alert_count,
    })),
  });
}

export async function cachedListCriticalAlerts(db: Pool): Promise<string> {
  const r = await db.query(`SELECT * FROM mv_critical_alerts`);
  const priorities = await db.query(`SELECT * FROM mv_alert_priority`);
  return JSON.stringify({
    priorityBreakdown: priorities.rows.map((row: Record<string, unknown>) => ({
      priority: row.priority,
      count: Number(row.alert_count),
      affectedDevices: Number(row.affected_devices),
      affectedSites: Number(row.affected_sites),
    })),
    topAlerts: r.rows.map((row: Record<string, unknown>) => ({
      alertUid: row.alert_uid,
      deviceUid: row.device_uid,
      hostname: row.hostname,
      siteName: row.site_name,
      priority: row.priority,
      message: row.alert_message,
      timestamp: row.alert_timestamp,
    })),
  });
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

/** Tools that are always local (vector DB / AI-service internals) — never forwarded to MCP bridge */
const LOCAL_ONLY_TOOLS = new Set(["semantic-search", "search-chat-history"]);

export function isLiveOnlyTool(toolName: string): boolean {
  return LIVE_ONLY_TOOLS.has(toolName);
}

export function isLocalOnlyTool(toolName: string): boolean {
  return LOCAL_ONLY_TOOLS.has(toolName);
}

/**
 * Execute a tool against the local cache.
 * Returns the result string (same format as MCP bridge result).
 * Throws if the tool is not cacheable.
 */
export async function executeCachedTool(
  toolName: string,
  args: Record<string, unknown>,
  db: Pool,
  allowedTools: string[]
): Promise<string> {
  // SEC-Cache-001: Defense-in-depth — even if the caller forgets to check,
  // this function will not execute an unauthorized tool.
  if (!allowedTools.includes(toolName)) {
    throw new Error(`SEC-Cache-001: Tool "${toolName}" not in allowedTools`);
  }

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

    // Materialized view tools (Stage 3)
    case "get-fleet-status":        return cachedGetFleetStatus(db);
    case "list-site-summaries":     return cachedListSiteSummaries(db);
    case "list-critical-alerts":    return cachedListCriticalAlerts(db);

    // Stage 7: Semantic vector search (always local)
    case "semantic-search": {
      const result = await semanticSearch(
        db,
        args["query"] as string,
        args["entityTypes"] as string[] | undefined,
        args["limit"] as number | undefined
      );
      return JSON.stringify(result);
    }

    // Stage 7: Chat history search (always local)
    case "search-chat-history": {
      const result = await chatHistorySearch(
        db,
        args["query"] as string,
        ["chat_qa"],
        Math.min(Number(args["limit"] ?? 5), 10)
      );
      return JSON.stringify(result);
    }

    default:
      throw new Error(`Tool "${toolName}" has no cached equivalent`);
  }
}
