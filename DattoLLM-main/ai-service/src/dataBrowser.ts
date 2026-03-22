/**
 * Data Browser — admin-only REST endpoints for exploring the local Datto cache.
 * All routes require x-user-role: admin (enforced in index.ts before calling these).
 */

import type { Request, Response } from "express";
import type { Pool } from "pg";

// ── Overview ───────────────────────────────────────────────────────────────

export async function handleBrowserOverview(req: Request, res: Response, db: Pool) {
  try {
    const r = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM datto_cache_sites)::int                            AS sites,
        (SELECT COUNT(*) FROM datto_cache_devices)::int                          AS devices,
        (SELECT COUNT(*) FROM datto_cache_devices WHERE online = true)::int      AS devices_online,
        (SELECT COUNT(*) FROM datto_cache_devices WHERE online = false)::int     AS devices_offline,
        (SELECT COUNT(*) FROM datto_cache_devices WHERE device_class='device')::int   AS workstations,
        (SELECT COUNT(*) FROM datto_cache_devices WHERE device_class='esxihost')::int AS esxi_hosts,
        (SELECT COUNT(*) FROM datto_cache_devices WHERE device_class='printer')::int  AS printers,
        (SELECT COUNT(*) FROM datto_cache_alerts WHERE resolved = false)::int    AS open_alerts,
        (SELECT COUNT(*) FROM datto_cache_alerts WHERE resolved = true)::int     AS resolved_alerts,
        (SELECT COUNT(*) FROM datto_cache_alerts WHERE resolved=false AND priority='Critical')::int AS critical_alerts,
        (SELECT COUNT(*) FROM datto_cache_alerts WHERE resolved=false AND priority='High')::int     AS high_alerts,
        (SELECT COUNT(*) FROM datto_cache_users)::int                            AS users,
        (SELECT COUNT(*) FROM datto_cache_device_audit)::int                     AS audited_devices,
        (SELECT COUNT(*) FROM datto_cache_device_software)::int                  AS software_entries
    `);

    const topSites = await db.query(`
      SELECT uid, name, device_count, online_count, offline_count
      FROM datto_cache_sites
      ORDER BY COALESCE(device_count, 0) DESC
      LIMIT 10
    `);

    const lastSync = await db.query(`
      SELECT status, started_at, completed_at, sites_synced, devices_synced,
             alerts_open_synced, device_audits_synced, audit_errors, error
      FROM datto_sync_log
      WHERE triggered_by IN ('schedule','manual')
      ORDER BY started_at DESC LIMIT 1
    `);

    res.json({
      counts: r.rows[0],
      topSites: topSites.rows,
      lastSync: lastSync.rows[0] ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

// ── Sites ──────────────────────────────────────────────────────────────────

export async function handleBrowserSites(req: Request, res: Response, db: Pool) {
  try {
    const search = (req.query["search"] as string) ?? "";
    const page = Math.max(1, Number(req.query["page"] ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query["pageSize"] ?? 50)));
    const offset = (page - 1) * pageSize;

    const where = search ? `WHERE name ILIKE $3` : "";
    const params: unknown[] = [pageSize, offset];
    if (search) params.push(`%${search}%`);

    const r = await db.query(
      `SELECT uid, id, name, description, on_demand, device_count, online_count, offline_count,
              autotask_company_name, synced_at
       FROM datto_cache_sites
       ${where}
       ORDER BY name
       LIMIT $1 OFFSET $2`,
      params
    );

    const total = await db.query(
      `SELECT COUNT(*)::int AS count FROM datto_cache_sites ${where}`,
      search ? [`%${search}%`] : []
    );

    res.json({
      sites: r.rows,
      total: (total.rows[0] as { count: number }).count,
      page,
      pageSize,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

export async function handleBrowserSite(req: Request, res: Response, db: Pool) {
  const { uid } = req.params;
  try {
    const site = await db.query(
      `SELECT uid, id, name, description, on_demand,
              device_count, online_count, offline_count,
              autotask_company_name, autotask_company_id,
              proxy_host, proxy_port, proxy_type,
              detail_data, settings_data, synced_at
       FROM datto_cache_sites WHERE uid = $1`,
      [uid]
    );
    if (!site.rows.length) { res.status(404).json({ error: "Site not found" }); return; }

    const devices = await db.query(
      `SELECT uid, hostname, int_ip_address, ext_ip_address,
              device_class, device_type, operating_system, display_version,
              online, reboot_required, last_seen, av_status, patch_status
       FROM datto_cache_devices
       WHERE site_uid = $1
       ORDER BY hostname`,
      [uid]
    );

    const alerts = await db.query(
      `SELECT alert_uid, device_name, alert_message, priority, resolved, muted, alert_timestamp
       FROM datto_cache_alerts
       WHERE site_uid = $1 AND resolved = false
       ORDER BY alert_timestamp DESC
       LIMIT 100`,
      [uid]
    );

    const variables = await db.query(
      `SELECT name, CASE WHEN masked THEN '****' ELSE value END AS value, masked
       FROM datto_cache_site_variables WHERE site_uid = $1 ORDER BY name`,
      [uid]
    );

    res.json({
      site: site.rows[0],
      devices: devices.rows,
      alerts: alerts.rows,
      variables: variables.rows,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

// ── Devices ────────────────────────────────────────────────────────────────

export async function handleBrowserDevices(req: Request, res: Response, db: Pool) {
  try {
    const page = Math.max(1, Number(req.query["page"] ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query["pageSize"] ?? 50)));
    const offset = (page - 1) * pageSize;

    const conditions: string[] = [];
    const params: unknown[] = [pageSize, offset];
    let pi = 3;

    const siteUid = req.query["siteUid"] as string;
    const hostname = req.query["hostname"] as string;
    const online = req.query["online"] as string;
    const deviceClass = req.query["deviceClass"] as string;
    const os = req.query["os"] as string;

    if (siteUid)     { conditions.push(`site_uid = $${pi++}`);              params.push(siteUid); }
    if (hostname)    { conditions.push(`hostname ILIKE $${pi++}`);          params.push(`%${hostname}%`); }
    if (online !== undefined && online !== "") {
      conditions.push(`online = $${pi++}`);
      params.push(online === "true");
    }
    if (deviceClass) { conditions.push(`device_class = $${pi++}`);          params.push(deviceClass); }
    if (os)          { conditions.push(`operating_system ILIKE $${pi++}`);  params.push(`%${os}%`); }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const filterParams = params.slice(2);

    const r = await db.query(
      `SELECT uid, hostname, site_uid, site_name,
              device_class, device_type, operating_system, display_version,
              online, reboot_required, last_seen, int_ip_address,
              av_status, patch_status
       FROM datto_cache_devices ${where}
       ORDER BY site_name, hostname
       LIMIT $1 OFFSET $2`,
      params
    );

    const total = await db.query(
      `SELECT COUNT(*)::int AS count FROM datto_cache_devices ${where}`,
      filterParams
    );

    res.json({
      devices: r.rows,
      total: (total.rows[0] as { count: number }).count,
      page,
      pageSize,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

export async function handleBrowserDevice(req: Request, res: Response, db: Pool) {
  const { uid } = req.params;
  try {
    const device = await db.query(
      `SELECT d.*,
              a.cpu_description, a.cpu_cores, a.cpu_processors, a.cpu_speed_mhz,
              a.ram_total_mb, a.bios_manufacturer, a.bios_version, a.bios_release_date,
              a.os_name, a.os_build, a.os_install_date,
              a.drive_count, a.total_storage_gb, a.free_storage_gb, a.nic_count,
              a.data AS audit_data,
              e.vm_count, e.datastore_count, e.data AS esxi_data,
              p.model AS printer_model, p.toner_black_pct, p.toner_cyan_pct,
              p.toner_magenta_pct, p.toner_yellow_pct, p.drum_pct, p.page_count
       FROM datto_cache_devices d
       LEFT JOIN datto_cache_device_audit a ON a.device_uid = d.uid
       LEFT JOIN datto_cache_esxi_audit e   ON e.device_uid = d.uid
       LEFT JOIN datto_cache_printer_audit p ON p.device_uid = d.uid
       WHERE d.uid = $1`,
      [uid]
    );
    if (!device.rows.length) { res.status(404).json({ error: "Device not found" }); return; }

    const alerts = await db.query(
      `SELECT alert_uid, alert_message, priority, resolved, muted, alert_timestamp, resolved_at
       FROM datto_cache_alerts
       WHERE device_uid = $1
       ORDER BY resolved ASC, alert_timestamp DESC
       LIMIT 50`,
      [uid]
    );

    const vulns = await db.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE severity = 'CRITICAL')::int AS critical,
         COUNT(*) FILTER (WHERE severity = 'HIGH')::int AS high,
         COUNT(*) FILTER (WHERE severity = 'MEDIUM')::int AS medium,
         COUNT(*) FILTER (WHERE severity = 'LOW')::int AS low
       FROM device_vulnerabilities WHERE device_uid = $1`,
      [uid]
    );

    res.json({
      device: device.rows[0],
      alerts: alerts.rows,
      vulnerabilities: vulns.rows[0] ?? { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

export async function handleBrowserDeviceSoftware(req: Request, res: Response, db: Pool) {
  const { uid } = req.params;
  try {
    const search = (req.query["search"] as string) ?? "";
    const page = Math.max(1, Number(req.query["page"] ?? 1));
    const pageSize = Math.min(200, Math.max(1, Number(req.query["pageSize"] ?? 50)));
    const offset = (page - 1) * pageSize;

    const where = search ? `AND name ILIKE $4` : "";
    const params: unknown[] = [uid, pageSize, offset];
    if (search) params.push(`%${search}%`);

    const r = await db.query(
      `SELECT s.name, s.version, s.publisher, s.install_date,
              COALESCE(v.cve_count, 0)::int AS cve_count,
              v.max_severity
       FROM datto_cache_device_software s
       LEFT JOIN (
         SELECT software_name, device_uid,
                COUNT(DISTINCT cve_id)::int AS cve_count,
                MAX(severity) AS max_severity
         FROM device_vulnerabilities
         GROUP BY software_name, device_uid
       ) v ON v.software_name = s.name AND v.device_uid = s.device_uid
       WHERE s.device_uid = $1 ${where}
       ORDER BY COALESCE(v.cve_count, 0) DESC, s.name
       LIMIT $2 OFFSET $3`,
      params
    );

    const total = await db.query(
      `SELECT COUNT(*)::int AS count FROM datto_cache_device_software WHERE device_uid = $1 ${where}`,
      search ? [uid, `%${search}%`] : [uid]
    );

    res.json({
      software: r.rows,
      total: (total.rows[0] as { count: number }).count,
      page,
      pageSize,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

// ── Alerts ─────────────────────────────────────────────────────────────────

export async function handleBrowserAlerts(req: Request, res: Response, db: Pool) {
  try {
    const page = Math.max(1, Number(req.query["page"] ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query["pageSize"] ?? 50)));
    const offset = (page - 1) * pageSize;

    const conditions: string[] = [];
    const params: unknown[] = [pageSize, offset];
    let pi = 3;

    const resolved = req.query["resolved"] as string;
    const siteUid = req.query["siteUid"] as string;
    const priority = req.query["priority"] as string;
    const search = req.query["search"] as string;

    if (resolved !== undefined && resolved !== "") {
      conditions.push(`resolved = $${pi++}`);
      params.push(resolved === "true");
    }
    if (siteUid)  { conditions.push(`site_uid = $${pi++}`);              params.push(siteUid); }
    if (priority) { conditions.push(`priority = $${pi++}`);              params.push(priority); }
    if (search)   { conditions.push(`alert_message ILIKE $${pi++}`);     params.push(`%${search}%`); }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const filterParams = params.slice(2);

    const r = await db.query(
      `SELECT alert_uid, device_uid, device_name, site_uid, site_name,
              alert_message, priority, resolved, muted, alert_timestamp, resolved_at
       FROM datto_cache_alerts ${where}
       ORDER BY alert_timestamp DESC
       LIMIT $1 OFFSET $2`,
      params
    );

    const total = await db.query(
      `SELECT COUNT(*)::int AS count FROM datto_cache_alerts ${where}`,
      filterParams
    );

    res.json({
      alerts: r.rows,
      total: (total.rows[0] as { count: number }).count,
      page,
      pageSize,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
