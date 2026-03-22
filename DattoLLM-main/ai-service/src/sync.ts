/**
 * Datto data sync service
 * Pulls data from Datto API (via MCP Server) into local PostgreSQL cache tables.
 * No AI involved — pure data pipeline.
 *
 * Call runSync() to trigger a full sync or runAlertSync() for alerts only.
 */

import type { Pool } from "pg";

const MCP_BRIDGE_URL = process.env["MCP_BRIDGE_URL"]!;
const MCP_INTERNAL_SECRET = process.env["MCP_INTERNAL_SECRET"] ?? "";

// ── Rate limiter ───────────────────────────────────────────────────────────
// Datto API: 600 GET requests per 60 seconds. We cap at 480 (80%) to stay safe.
// At 90% usage Datto adds 1s delays; at 100% we get 429; persistent 429s → 403 IP block.

const RATE_LIMIT_MAX = 480;
const RATE_WINDOW_MS = 60_000;
const requestTimestamps: number[] = [];

async function rateLimit(): Promise<void> {
  const now = Date.now();
  // Drop timestamps outside the 60s window
  while (requestTimestamps.length > 0 && requestTimestamps[0]! < now - RATE_WINDOW_MS) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= RATE_LIMIT_MAX) {
    // Wait until the oldest request falls outside the window
    const waitMs = requestTimestamps[0]! + RATE_WINDOW_MS - now + 50;
    await new Promise((r) => setTimeout(r, waitMs));
    requestTimestamps.shift();
  }
  requestTimestamps.push(Date.now());
}

// ── MCP tool caller ────────────────────────────────────────────────────────

async function callMcpTool(
  toolName: string,
  args: Record<string, unknown> = {},
  attempt = 1
): Promise<unknown> {
  await rateLimit();
  const res = await fetch(`${MCP_BRIDGE_URL}/tool-call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": MCP_INTERNAL_SECRET,
    },
    body: JSON.stringify({
      toolName,
      toolArgs: args,
      // sync service is always allowed to call any read tool
      allowedTools: [toolName],
      requestId: `sync-${Date.now()}`,
      userId: "sync-service",
    }),
  });
  // 429: Datto rate limit hit — wait 60s then retry once
  if (res.status === 429 && attempt === 1) {
    await new Promise((r) => setTimeout(r, 62_000));
    return callMcpTool(toolName, args, 2);
  }
  if (!res.ok) throw new Error(`MCP call failed ${res.status}: ${toolName}`);
  const body = (await res.json()) as { result: unknown; isError?: boolean };
  if (body.isError) throw new Error(`Tool error: ${JSON.stringify(body.result)}`);
  // MCP returns { result: { content: [{ type: "text", text: "..." }] } }
  const content = (body.result as { content?: { text?: string }[] })?.content;
  if (content?.[0]?.text) {
    try { return JSON.parse(content[0].text); } catch { return content[0].text; }
  }
  return body.result;
}

// ── Paginated fetch helper ─────────────────────────────────────────────────
// Datto API uses entity-specific array keys (sites/devices/alerts/etc.),
// page parameter starting at 0, max for page size, and nextPageUrl for continuation.

async function fetchAllPages<T>(
  toolName: string,
  arrayKey: string,
  baseArgs: Record<string, unknown> = {},
  pageSize = 250
): Promise<T[]> {
  const items: T[] = [];
  let page = 0;
  while (true) {
    const data = (await callMcpTool(toolName, { ...baseArgs, max: pageSize, page })) as Record<string, unknown>;
    const rows = (data[arrayKey] as T[] | undefined) ?? [];
    items.push(...rows);
    const nextPageUrl = (data["pageDetails"] as Record<string, unknown> | undefined)?.["nextPageUrl"];
    if (!nextPageUrl || rows.length === 0) break;
    page++;
  }
  return items;
}

// ── Individual sync functions ──────────────────────────────────────────────

async function syncAccount(db: Pool): Promise<void> {
  const data = (await callMcpTool("get-account")) as Record<string, unknown>;
  await db.query(
    `INSERT INTO datto_cache_account (id, uid, name, portal_url, device_count, online_count, offline_count, data, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (id) DO UPDATE SET
       uid = EXCLUDED.uid, name = EXCLUDED.name, portal_url = EXCLUDED.portal_url,
       device_count = EXCLUDED.device_count, online_count = EXCLUDED.online_count,
       offline_count = EXCLUDED.offline_count, data = EXCLUDED.data, synced_at = NOW()`,
    [
      data["id"],
      data["uid"],
      data["name"],
      data["portalUrl"] ?? null,
      (data["devicesStatus"] as Record<string, unknown>)?.["numberOfDevices"] ?? null,
      (data["devicesStatus"] as Record<string, unknown>)?.["numberOfOnlineDevices"] ?? null,
      (data["devicesStatus"] as Record<string, unknown>)?.["numberOfOfflineDevices"] ?? null,
      JSON.stringify(data),
    ]
  );
}

async function syncSites(db: Pool): Promise<number> {
  const sites = await fetchAllPages<Record<string, unknown>>("list-sites", "sites");

  for (const site of sites) {
    // Upsert basic site row from list
    await db.query(
      `INSERT INTO datto_cache_sites (uid, id, name, description, on_demand, device_count, online_count, offline_count, data, synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (uid) DO UPDATE SET
         id = EXCLUDED.id, name = EXCLUDED.name, description = EXCLUDED.description,
         on_demand = EXCLUDED.on_demand, device_count = EXCLUDED.device_count,
         online_count = EXCLUDED.online_count, offline_count = EXCLUDED.offline_count,
         data = EXCLUDED.data, synced_at = NOW()`,
      [
        site["uid"], site["id"], site["name"], site["description"] ?? null,
        site["onDemand"] ?? false,
        (site["devicesStatus"] as Record<string, unknown>)?.["numberOfDevices"] ?? site["devicesCount"] ?? null,
        (site["devicesStatus"] as Record<string, unknown>)?.["numberOfOnlineDevices"] ?? site["onlineDevicesCount"] ?? null,
        (site["devicesStatus"] as Record<string, unknown>)?.["numberOfOfflineDevices"] ?? null,
        JSON.stringify(site),
      ]
    );

    // Fetch site detail
    try {
      const detail = (await callMcpTool("get-site", { siteUid: site["uid"] })) as Record<string, unknown>;
      await db.query(
        `UPDATE datto_cache_sites SET
           autotask_company_name = $1, autotask_company_id = $2, detail_data = $3
         WHERE uid = $4`,
        [detail["autotaskCompanyName"] ?? null, detail["autotaskCompanyId"] ?? null, JSON.stringify(detail), site["uid"]]
      );
    } catch { /* skip — site detail may not exist */ }

    // Fetch site settings
    try {
      const settings = (await callMcpTool("get-site-settings", { siteUid: site["uid"] })) as Record<string, unknown>;
      await db.query(
        `UPDATE datto_cache_sites SET
           proxy_host = $1, proxy_port = $2, proxy_type = $3, settings_data = $4
         WHERE uid = $5`,
        [settings["proxyHost"] ?? null, settings["proxyPort"] ?? null, settings["proxyType"] ?? null, JSON.stringify(settings), site["uid"]]
      );
    } catch { /* skip */ }

    // Fetch site variables
    try {
      const vars = (await callMcpTool("get-site-variables", { siteUid: site["uid"] })) as { variables?: Record<string, unknown>[] };
      const rows = vars?.variables ?? [];
      if (rows.length > 0) {
        await db.query(`DELETE FROM datto_cache_site_variables WHERE site_uid = $1`, [site["uid"]]);
        for (const v of rows) {
          await db.query(
            `INSERT INTO datto_cache_site_variables (id, site_uid, name, value, masked, synced_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (site_uid, name) DO UPDATE SET value = EXCLUDED.value, masked = EXCLUDED.masked, synced_at = NOW()`,
            [v["id"] ?? null, site["uid"], v["name"], v["value"] ?? null, v["masked"] ?? false]
          );
        }
      }
    } catch { /* skip */ }

    // Fetch site filters
    try {
      const filters = (await callMcpTool("get-site-filters", { siteUid: site["uid"] })) as { filters?: Record<string, unknown>[] };
      const rows = filters?.filters ?? [];
      if (rows.length > 0) {
        await db.query(`DELETE FROM datto_cache_site_filters WHERE site_uid = $1`, [site["uid"]]);
        for (const f of rows) {
          await db.query(
            `INSERT INTO datto_cache_site_filters (id, site_uid, name, data, synced_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (site_uid, id) DO UPDATE SET name = EXCLUDED.name, data = EXCLUDED.data, synced_at = NOW()`,
            [f["id"], site["uid"], f["name"] ?? "", JSON.stringify(f)]
          );
        }
      }
    } catch { /* skip */ }
  }

  return sites.length;
}

async function syncDevices(db: Pool): Promise<number> {
  const devices = await fetchAllPages<Record<string, unknown>>("list-devices", "devices");

  for (const d of devices) {
    const udf: Record<string, string | null> = {};
    for (let i = 1; i <= 30; i++) {
      udf[`udf${i}`] = (d[`udf${i}`] as string | undefined) ?? null;
    }
    await db.query(
      `INSERT INTO datto_cache_devices (
         uid, id, hostname, int_ip_address, ext_ip_address, site_uid, site_name,
         device_class, device_type, operating_system, display_version, online,
         reboot_required, last_seen, warranty_date, av_product, av_status, patch_status,
         domain, last_logged_in_user, last_reboot, last_audit_date, description, suspended, category,
         udf1,udf2,udf3,udf4,udf5,udf6,udf7,udf8,udf9,udf10,
         udf11,udf12,udf13,udf14,udf15,udf16,udf17,udf18,udf19,udf20,
         udf21,udf22,udf23,udf24,udf25,udf26,udf27,udf28,udf29,udf30,
         data, synced_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
         $19,$20,$21,$22,$23,$24,$25,
         $26,$27,$28,$29,$30,$31,$32,$33,$34,$35,
         $36,$37,$38,$39,$40,$41,$42,$43,$44,$45,
         $46,$47,$48,$49,$50,$51,$52,$53,$54,$55,
         $56, NOW()
       )
       ON CONFLICT (uid) DO UPDATE SET
         hostname = EXCLUDED.hostname, int_ip_address = EXCLUDED.int_ip_address,
         ext_ip_address = EXCLUDED.ext_ip_address, site_uid = EXCLUDED.site_uid,
         site_name = EXCLUDED.site_name, device_class = EXCLUDED.device_class,
         device_type = EXCLUDED.device_type, operating_system = EXCLUDED.operating_system,
         display_version = EXCLUDED.display_version, online = EXCLUDED.online,
         reboot_required = EXCLUDED.reboot_required, last_seen = EXCLUDED.last_seen,
         warranty_date = EXCLUDED.warranty_date, av_product = EXCLUDED.av_product,
         av_status = EXCLUDED.av_status, patch_status = EXCLUDED.patch_status,
         domain = EXCLUDED.domain, last_logged_in_user = EXCLUDED.last_logged_in_user,
         last_reboot = EXCLUDED.last_reboot, last_audit_date = EXCLUDED.last_audit_date,
         description = EXCLUDED.description, suspended = EXCLUDED.suspended,
         category = EXCLUDED.category,
         data = EXCLUDED.data, synced_at = NOW()`,
      [
        d["uid"], d["id"], d["hostname"], d["intIpAddress"] ?? null, d["extIpAddress"] ?? null,
        d["siteUid"] ?? null, d["siteName"] ?? null,
        d["deviceClass"] ?? null, d["deviceType"] ?? null,
        d["operatingSystem"] ?? null, d["displayVersion"] ?? null,
        d["online"] ?? null, d["rebootRequired"] ?? null,
        d["lastSeen"] ? new Date(d["lastSeen"] as string) : null,
        d["warrantyDate"] ?? null,
        (d["antivirus"] as Record<string, unknown>)?.["antivirusProduct"] ?? null,
        (d["antivirus"] as Record<string, unknown>)?.["antivirusStatus"] ?? null,
        (d["patchManagement"] as Record<string, unknown>)?.["patchStatus"] ?? null,
        d["domain"] ?? null,
        d["lastLoggedInUser"] ?? null,
        d["lastReboot"] ? new Date(d["lastReboot"] as number) : null,
        d["lastAuditDate"] ? new Date(d["lastAuditDate"] as number) : null,
        d["description"] ?? null,
        d["suspended"] ?? false,
        (d["deviceType"] as Record<string, unknown>)?.["category"] ?? null,
        ...Array.from({ length: 30 }, (_, i) => udf[`udf${i + 1}`] ?? null),
        JSON.stringify(d),
      ]
    );
  }

  return devices.length;
}

async function syncAlerts(db: Pool): Promise<{ open: number; resolved: number }> {
  // Open alerts
  const openAlerts = await fetchAllPages<Record<string, unknown>>("list-open-alerts", "alerts");

  for (const a of openAlerts) {
    // Datto nests device/site info under alertSourceInfo, message under alertMonitorInfo
    const src = (a["alertSourceInfo"] as Record<string, unknown>) ?? {};
    const mon = (a["alertMonitorInfo"] as Record<string, unknown>) ?? {};
    const ts = a["timestamp"] as number | null;
    await db.query(
      `INSERT INTO datto_cache_alerts (alert_uid, device_uid, device_name, site_uid, site_name,
         alert_message, priority, resolved, muted, alert_timestamp, resolved_at, autotask_ticket, data, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8,$9,null,$10,$11,NOW())
       ON CONFLICT (alert_uid) DO UPDATE SET
         device_uid = COALESCE(EXCLUDED.device_uid, datto_cache_alerts.device_uid),
         device_name = COALESCE(EXCLUDED.device_name, datto_cache_alerts.device_name),
         site_uid = COALESCE(EXCLUDED.site_uid, datto_cache_alerts.site_uid),
         site_name = COALESCE(EXCLUDED.site_name, datto_cache_alerts.site_name),
         alert_message = EXCLUDED.alert_message, priority = EXCLUDED.priority,
         resolved = false, muted = EXCLUDED.muted, alert_timestamp = EXCLUDED.alert_timestamp,
         autotask_ticket = EXCLUDED.autotask_ticket, data = EXCLUDED.data, synced_at = NOW()`,
      [
        a["alertUid"],
        (src["deviceUid"] as string) ?? null,
        (src["deviceName"] as string) ?? null,
        (src["siteUid"] as string) ?? null,
        (src["siteName"] as string) ?? null,
        (mon["alertMessage"] as string) ?? (a["diagnostics"] as string) ?? "",
        a["priority"] ?? null, a["muted"] ?? false,
        ts ? new Date(ts) : null,
        a["ticketNumber"] ?? null, JSON.stringify(a),
      ]
    );
  }

  // Resolved alerts
  const resolvedAlerts = await fetchAllPages<Record<string, unknown>>("list-resolved-alerts", "alerts");

  for (const a of resolvedAlerts) {
    const src = (a["alertSourceInfo"] as Record<string, unknown>) ?? {};
    const mon = (a["alertMonitorInfo"] as Record<string, unknown>) ?? {};
    const ts = a["timestamp"] as number | null;
    const resolvedOn = a["resolvedOn"] as number | null;
    await db.query(
      `INSERT INTO datto_cache_alerts (alert_uid, device_uid, device_name, site_uid, site_name,
         alert_message, priority, resolved, muted, alert_timestamp, resolved_at, autotask_ticket, data, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10,$11,$12,NOW())
       ON CONFLICT (alert_uid) DO UPDATE SET
         device_uid = COALESCE(EXCLUDED.device_uid, datto_cache_alerts.device_uid),
         device_name = COALESCE(EXCLUDED.device_name, datto_cache_alerts.device_name),
         site_uid = COALESCE(EXCLUDED.site_uid, datto_cache_alerts.site_uid),
         site_name = COALESCE(EXCLUDED.site_name, datto_cache_alerts.site_name),
         alert_message = EXCLUDED.alert_message, priority = EXCLUDED.priority,
         resolved = true, muted = EXCLUDED.muted, alert_timestamp = EXCLUDED.alert_timestamp,
         resolved_at = EXCLUDED.resolved_at, autotask_ticket = EXCLUDED.autotask_ticket,
         data = EXCLUDED.data, synced_at = NOW()`,
      [
        a["alertUid"],
        (src["deviceUid"] as string) ?? null,
        (src["deviceName"] as string) ?? null,
        (src["siteUid"] as string) ?? null,
        (src["siteName"] as string) ?? null,
        (mon["alertMessage"] as string) ?? (a["diagnostics"] as string) ?? "",
        a["priority"] ?? null, a["muted"] ?? false,
        ts ? new Date(ts) : null,
        resolvedOn ? new Date(resolvedOn) : null,
        a["ticketNumber"] ?? null, JSON.stringify(a),
      ]
    );
  }

  return { open: openAlerts.length, resolved: resolvedAlerts.length };
}

async function syncUsers(db: Pool): Promise<number> {
  // list-users may not be paginated; try paginated first, fall back to direct call
  let users: Record<string, unknown>[] = [];
  try {
    users = await fetchAllPages<Record<string, unknown>>("list-users", "users");
  } catch {
    const result = (await callMcpTool("list-users")) as { users?: Record<string, unknown>[] };
    users = result?.users ?? [];
  }
  for (const u of users) {
    const email = (u["email"] as string | undefined) ?? "";
    if (!email) continue; // skip users with no email — can't use as PK
    await db.query(
      `INSERT INTO datto_cache_users (email, username, first_name, last_name, telephone, status, last_access, disabled, data, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       ON CONFLICT (email) DO UPDATE SET
         username = EXCLUDED.username, first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
         telephone = EXCLUDED.telephone, status = EXCLUDED.status,
         last_access = EXCLUDED.last_access, disabled = EXCLUDED.disabled,
         data = EXCLUDED.data, synced_at = NOW()`,
      [
        email,
        u["username"] ?? null,
        u["firstName"] ?? null,
        u["lastName"] ?? null,
        u["telephone"] ?? null,
        u["status"] ?? null,
        u["lastAccess"] ? new Date(u["lastAccess"] as string) : null,
        u["disabled"] ?? null,
        JSON.stringify(u),
      ]
    );
  }
  return users.length;
}

async function syncAccountVariables(db: Pool): Promise<void> {
  const result = (await callMcpTool("list-account-variables")) as { variables?: Record<string, unknown>[] };
  const vars = result?.variables ?? [];
  for (const v of vars) {
    await db.query(
      `INSERT INTO datto_cache_account_variables (id, name, value, masked, synced_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, value = EXCLUDED.value, masked = EXCLUDED.masked, synced_at = NOW()`,
      [v["id"], v["name"] ?? "", v["value"] ?? null, v["masked"] ?? false]
    );
  }
}

async function syncComponents(db: Pool): Promise<void> {
  const result = (await callMcpTool("list-components")) as { components?: Record<string, unknown>[] };
  const items = result?.components ?? [];
  for (const c of items) {
    await db.query(
      `INSERT INTO datto_cache_components (uid, id, name, category, component_type, data, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (uid) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category,
         component_type = EXCLUDED.component_type, data = EXCLUDED.data, synced_at = NOW()`,
      [c["uid"], c["id"] ?? null, c["name"] ?? "", c["category"] ?? null, c["componentType"] ?? null, JSON.stringify(c)]
    );
  }
}

async function syncFilters(db: Pool): Promise<void> {
  // Default filters
  try {
    const defResult = (await callMcpTool("list-default-filters")) as { filters?: Record<string, unknown>[] };
    for (const f of defResult?.filters ?? []) {
      await db.query(
        `INSERT INTO datto_cache_filters (id, name, filter_type, data, synced_at)
         VALUES ($1,$2,'default',$3,NOW())
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, data = EXCLUDED.data, synced_at = NOW()`,
        [f["id"], f["name"] ?? "", JSON.stringify(f)]
      );
    }
  } catch { /* skip */ }
  // Custom filters
  try {
    const custResult = (await callMcpTool("list-custom-filters")) as { filters?: Record<string, unknown>[] };
    for (const f of custResult?.filters ?? []) {
      await db.query(
        `INSERT INTO datto_cache_filters (id, name, filter_type, data, synced_at)
         VALUES ($1,$2,'custom',$3,NOW())
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, data = EXCLUDED.data, synced_at = NOW()`,
        [f["id"], f["name"] ?? "", JSON.stringify(f)]
      );
    }
  } catch { /* skip */ }
}

async function syncDeviceAudits(db: Pool): Promise<{ audits: number; software: number; esxi: number; printers: number; errors: number; lastError: string | null }> {
  const devices = await db.query(`SELECT uid, device_class FROM datto_cache_devices`);
  let audits = 0, software = 0, esxi = 0, printers = 0, errors = 0;
  let lastError: string | null = null;

  for (const row of devices.rows as { uid: string; device_class: string }[]) {
    const { uid, device_class } = row;

    if (device_class === "device") {
      // Hardware audit
      try {
        const audit = (await callMcpTool("get-device-audit", { deviceUid: uid })) as Record<string, unknown>;
        // Datto audit structure: processors[], systemInfo{}, baseBoard{}, bios{}, logicalDisks[], nics[]
        const processors = (audit["processors"] as { name?: string }[]) ?? [];
        const sysInfo = (audit["systemInfo"] as Record<string, unknown>) ?? {};
        const ramBytes = (sysInfo["totalPhysicalMemory"] as number) ?? 0;
        const ram = ramBytes > 0 ? Math.round(ramBytes / 1048576) : null; // bytes → MB
        const cpu = {
          description: processors[0]?.name ?? null,
          cores: (sysInfo["totalCpuCores"] as number) ?? null,
          processors: processors.length || null,
          speedMhz: null, // not provided by Datto API
        };
        const baseBoard = (audit["baseBoard"] as Record<string, unknown>) ?? {};
        const biosData = (audit["bios"] as Record<string, unknown>) ?? {};
        const bios = {
          manufacturer: (baseBoard["manufacturer"] as string) ?? null,
          version: (biosData["smBiosVersion"] as string) ?? (biosData["instance"] as string) ?? null,
          releaseDate: biosData["releaseDate"] ? new Date(biosData["releaseDate"] as number).toISOString().split("T")[0] : null,
        };
        const os = (audit["operatingSystem"] as Record<string, unknown>) ?? {};
        const drives = (audit["logicalDisks"] as unknown[]) ?? [];
        const nics = (audit["nics"] as unknown[]) ?? [];
        const totalGB = drives.reduce((s: number, d: unknown) => s + (((d as Record<string, unknown>)["size"] as number) ?? 0) / 1073741824, 0);
        const freeGB = drives.reduce((s: number, d: unknown) => s + (((d as Record<string, unknown>)["freespace"] as number) ?? 0) / 1073741824, 0);
        await db.query(
          `INSERT INTO datto_cache_device_audit (device_uid, cpu_description, cpu_cores, cpu_processors, cpu_speed_mhz,
             ram_total_mb, bios_manufacturer, bios_version, bios_release_date, os_name, os_build, os_install_date,
             drive_count, total_storage_gb, free_storage_gb, nic_count, data, synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
           ON CONFLICT (device_uid) DO UPDATE SET
             cpu_description = EXCLUDED.cpu_description, cpu_cores = EXCLUDED.cpu_cores,
             cpu_speed_mhz = EXCLUDED.cpu_speed_mhz, ram_total_mb = EXCLUDED.ram_total_mb,
             bios_version = EXCLUDED.bios_version, os_name = EXCLUDED.os_name, os_build = EXCLUDED.os_build,
             drive_count = EXCLUDED.drive_count, total_storage_gb = EXCLUDED.total_storage_gb,
             free_storage_gb = EXCLUDED.free_storage_gb, nic_count = EXCLUDED.nic_count,
             data = EXCLUDED.data, synced_at = NOW()`,
          [
            uid,
            cpu["description"] ?? null, cpu["cores"] ?? null, cpu["processors"] ?? null, cpu["speedMhz"] ?? null,
            ram ?? null,
            bios["manufacturer"] ?? null, bios["version"] ?? null, bios["releaseDate"] ?? null,
            os["name"] ?? null, os["build"] ?? null, os["installDate"] ?? null,
            drives.length, Math.round(totalGB), Math.round(freeGB), nics.length,
            JSON.stringify(audit),
          ]
        );
        audits++;

        // Extract extended audit data into dedicated tables
        try {
          // Physical Memory / DIMMs
          const physMem = (audit["physicalMemory"] as { bank?: string; size?: number; type?: string; speed?: string; partNumber?: string; serialNumber?: string; module?: string }[]) ?? [];
          if (physMem.length > 0) {
            await db.query(`DELETE FROM datto_cache_device_memory WHERE device_uid = $1`, [uid]);
            for (const m of physMem) {
              if (!m.size) continue;
              await db.query(
                `INSERT INTO datto_cache_device_memory (device_uid, slot, capacity_bytes, memory_type, speed, part_number, serial_number, bank)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [uid, m.module ?? m.bank ?? null, m.size ?? null, m.type ?? null, m.speed ?? null, (m.partNumber ?? "").trim() || null, (m.serialNumber ?? "").trim() || null, m.bank ?? null]
              );
            }
          }

          // GPU / Video
          const gpus = (audit["videoBoards"] as { displayAdapter?: string }[]) ?? [];
          if (gpus.length > 0) {
            await db.query(`DELETE FROM datto_cache_device_gpu WHERE device_uid = $1`, [uid]);
            for (const g of gpus) {
              if (!g.displayAdapter) continue;
              await db.query(
                `INSERT INTO datto_cache_device_gpu (device_uid, display_adapter) VALUES ($1,$2)`,
                [uid, g.displayAdapter]
              );
            }
          }

          // Displays / Monitors
          const displays = (audit["displays"] as { name?: string; manufacturer?: string; serialNumber?: string }[]) ?? [];
          if (displays.length > 0) {
            await db.query(`DELETE FROM datto_cache_device_displays WHERE device_uid = $1`, [uid]);
            for (const d of displays) {
              await db.query(
                `INSERT INTO datto_cache_device_displays (device_uid, name, manufacturer, serial_number) VALUES ($1,$2,$3,$4)`,
                [uid, d.name ?? null, d.manufacturer ?? null, d.serialNumber ?? null]
              );
            }
          }

          // Network Interfaces (detailed)
          if (nics.length > 0) {
            await db.query(`DELETE FROM datto_cache_device_nics WHERE device_uid = $1`, [uid]);
            for (const n of nics as { instance?: string; type?: string; ipv4?: string; ipv6?: string; macAddress?: string }[]) {
              await db.query(
                `INSERT INTO datto_cache_device_nics (device_uid, name, type, ipv4, ipv6, mac_address) VALUES ($1,$2,$3,$4,$5,$6)`,
                [uid, n.instance ?? null, n.type ?? null, n.ipv4 ?? null, n.ipv6 ?? null, n.macAddress ?? null]
              );
            }
          }
        } catch { /* extended audit extraction is best-effort */ }

      } catch (err) {
        errors++;
        lastError = err instanceof Error ? err.message : String(err);
      }

      // Software
      try {
        const sw = (await callMcpTool("get-device-software", { deviceUid: uid })) as { software?: Record<string, unknown>[] };
        const list = sw?.software ?? [];
        await db.query(`DELETE FROM datto_cache_device_software WHERE device_uid = $1`, [uid]);
        for (const s of list) {
          await db.query(
            `INSERT INTO datto_cache_device_software (device_uid, name, version, publisher, install_date, synced_at)
             VALUES ($1,$2,$3,$4,$5,NOW())`,
            [uid, s["name"] ?? "", s["version"] ?? null, s["publisher"] ?? null, s["installDate"] ?? null]
          );
        }
        software++;
      } catch (err) {
        errors++;
        lastError = err instanceof Error ? err.message : String(err);
      }

    } else if (device_class === "esxihost") {
      try {
        const audit = (await callMcpTool("get-esxi-audit", { deviceUid: uid })) as Record<string, unknown>;
        const vms = (audit["virtualMachines"] as unknown[]) ?? [];
        const datastores = (audit["datastores"] as unknown[]) ?? [];
        await db.query(
          `INSERT INTO datto_cache_esxi_audit (device_uid, vm_count, datastore_count, data, synced_at)
           VALUES ($1,$2,$3,$4,NOW())
           ON CONFLICT (device_uid) DO UPDATE SET vm_count = EXCLUDED.vm_count, datastore_count = EXCLUDED.datastore_count, data = EXCLUDED.data, synced_at = NOW()`,
          [uid, vms.length, datastores.length, JSON.stringify(audit)]
        );
        esxi++;
      } catch (err) {
        errors++;
        lastError = err instanceof Error ? err.message : String(err);
      }

    } else if (device_class === "printer") {
      try {
        const audit = (await callMcpTool("get-printer-audit", { deviceUid: uid })) as Record<string, unknown>;
        const supplies = (audit["supplies"] as Record<string, unknown>) ?? {};
        await db.query(
          `INSERT INTO datto_cache_printer_audit (device_uid, model, toner_black_pct, toner_cyan_pct,
             toner_magenta_pct, toner_yellow_pct, drum_pct, page_count, data, synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
           ON CONFLICT (device_uid) DO UPDATE SET model = EXCLUDED.model, toner_black_pct = EXCLUDED.toner_black_pct,
             toner_cyan_pct = EXCLUDED.toner_cyan_pct, toner_magenta_pct = EXCLUDED.toner_magenta_pct,
             toner_yellow_pct = EXCLUDED.toner_yellow_pct, drum_pct = EXCLUDED.drum_pct,
             page_count = EXCLUDED.page_count, data = EXCLUDED.data, synced_at = NOW()`,
          [
            uid, audit["model"] ?? null,
            supplies["blackToner"] ?? null, supplies["cyanToner"] ?? null,
            supplies["magentaToner"] ?? null, supplies["yellowToner"] ?? null,
            supplies["drum"] ?? null, audit["pageCount"] ?? null,
            JSON.stringify(audit),
          ]
        );
        printers++;
      } catch (err) {
        errors++;
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  return { audits, software, esxi, printers, errors, lastError };
}

// ── Public sync runners ────────────────────────────────────────────────────

// SEC-011: Distributed lock keys for pg_advisory_lock.
// Prevents two concurrent sync runs from hammering the Datto rate limit simultaneously.
const LOCK_FULL_SYNC  = 42_424_241;
const LOCK_ALERT_SYNC = 42_424_242;

export async function runAlertSync(db: Pool, triggeredBy = "schedule"): Promise<void> {
  // SEC-011: Acquire advisory lock — skip if another alert sync is already running
  const lockClient = await db.connect();
  const lockResult = await lockClient.query<{ acquired: boolean }>(
    "SELECT pg_try_advisory_lock($1) AS acquired", [LOCK_ALERT_SYNC]
  );
  if (!lockResult.rows[0]?.acquired) {
    lockClient.release();
    return; // Another alert sync is running — skip this invocation
  }

  const logResult = await db.query(
    `INSERT INTO datto_sync_log (triggered_by, status) VALUES ($1, 'running') RETURNING id`,
    [triggeredBy]
  );
  const logId = (logResult.rows[0] as { id: string }).id;

  try {
    const { open, resolved } = await syncAlerts(db);
    await db.query(
      `UPDATE datto_sync_log SET status = 'completed', completed_at = NOW(),
         alerts_open_synced = $1, alerts_resolved_synced = $2 WHERE id = $3`,
      [open, resolved, logId]
    );
  } catch (err) {
    await db.query(
      `UPDATE datto_sync_log SET status = 'failed', completed_at = NOW(), error = $1 WHERE id = $2`,
      [err instanceof Error ? err.message : String(err), logId]
    );
    throw err;
  } finally {
    await lockClient.query("SELECT pg_advisory_unlock($1)", [LOCK_ALERT_SYNC]).catch(() => {});
    lockClient.release();
  }
}

// ── Activity Log Sync ─────────────────────────────────────────────────────

async function syncActivityLogs(db: Pool): Promise<number> {
  try {
    const data = (await callMcpTool("get-activity-logs", { max: 250 })) as Record<string, unknown>;
    const activities = (data["activities"] as Record<string, unknown>[]) ?? [];

    for (const a of activities) {
      const site = (a["site"] as Record<string, unknown>) ?? {};
      let details: unknown = null;
      try { details = typeof a["details"] === "string" ? JSON.parse(a["details"] as string) : a["details"]; } catch { details = a["details"]; }

      await db.query(
        `INSERT INTO datto_cache_activity_logs (id, entity, category, action, activity_date, site_id, site_name, device_id, hostname, username, details, has_stdout, has_stderr, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
         ON CONFLICT (id) DO NOTHING`,
        [
          a["id"] ?? `gen-${Date.now()}-${Math.random()}`,
          a["entity"] ?? null,
          a["category"] ?? null,
          a["action"] ?? null,
          a["date"] ? new Date((a["date"] as number) * 1000) : null,
          (site["id"] as number) ?? null,
          (site["name"] as string) ?? null,
          (a["deviceId"] as number) ?? null,
          (a["hostname"] as string) ?? null,
          (a["user"] as string) ?? null,
          details ? JSON.stringify(details) : null,
          a["hasStdOut"] ?? false,
          a["hasStdErr"] ?? false,
        ]
      );
    }
    return activities.length;
  } catch {
    return 0;
  }
}

export async function runSync(db: Pool, triggeredBy = "schedule"): Promise<void> {
  // SEC-011: Acquire advisory lock — skip if a full sync is already running
  const lockClient = await db.connect();
  const lockResult = await lockClient.query<{ acquired: boolean }>(
    "SELECT pg_try_advisory_lock($1) AS acquired", [LOCK_FULL_SYNC]
  );
  if (!lockResult.rows[0]?.acquired) {
    lockClient.release();
    return; // Another full sync is running — skip this invocation
  }

  const logResult = await db.query(
    `INSERT INTO datto_sync_log (triggered_by, status) VALUES ($1, 'running') RETURNING id`,
    [triggeredBy]
  );
  const logId = (logResult.rows[0] as { id: string }).id;

  try {
    // Stage 1 — parallel, no dependencies
    await Promise.all([
      syncAccount(db),
      syncUsers(db),
      syncAccountVariables(db),
      syncComponents(db),
      syncFilters(db),
    ]);

    // Stage 2 — sites (needed before devices)
    const sitesCount = await syncSites(db);

    // Stage 3 — devices
    const devicesCount = await syncDevices(db);

    // Stage 4 — alerts (independent of devices)
    const { open, resolved } = await syncAlerts(db);

    // Stage 5 — device audits (depends on devices)
    const { audits, software, esxi, printers, errors: auditErrors, lastError: auditLastError } = await syncDeviceAudits(db);

    // Sync activity logs (best effort, won't fail the sync)
    const activityCount = await syncActivityLogs(db);

    await db.query(
      `UPDATE datto_sync_log SET
         status = 'completed', completed_at = NOW(),
         sites_synced = $1, devices_synced = $2,
         alerts_open_synced = $3, alerts_resolved_synced = $4,
         users_synced = $5, device_audits_synced = $6,
         device_software_synced = $7, esxi_audits_synced = $8, printer_audits_synced = $9,
         audit_errors = $10, last_api_error = $11
       WHERE id = $12`,
      [sitesCount, devicesCount, open, resolved, 0, audits, software, esxi, printers, auditErrors, auditLastError, logId]
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.query(
      `UPDATE datto_sync_log SET status = 'failed', completed_at = NOW(), error = $1, last_api_error = $1 WHERE id = $2`,
      [msg, logId]
    );
    throw err;
  } finally {
    await lockClient.query("SELECT pg_advisory_unlock($1)", [LOCK_FULL_SYNC]).catch(() => {});
    lockClient.release();
  }
}

// ── Scheduled sync (cron-like interval) ───────────────────────────────────

let fullSyncTimer: ReturnType<typeof setTimeout> | null = null;
let alertSyncTimer: ReturnType<typeof setTimeout> | null = null;

// ── Pause / resume ─────────────────────────────────────────────────────────

let syncPaused = false;

export function pauseSync(): void  { syncPaused = true;  }
export function resumeSync(): void { syncPaused = false; }
export function isSyncPaused(): boolean { return syncPaused; }

export function startScheduledSync(db: Pool): void {
  // Full sync — daily at 02:00 UTC (check every hour, run if past 02:00 and not run today)
  const scheduleFullSync = () => {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 2, 0, 0, 0));
    if (now.getUTCHours() >= 2) next.setUTCDate(next.getUTCDate() + 1);
    const ms = next.getTime() - now.getTime();
    fullSyncTimer = setTimeout(() => {
      if (!syncPaused) runSync(db, "schedule").catch(() => {});
      scheduleFullSync();
    }, ms);
  };
  scheduleFullSync();

  // Alert sync — every hour
  const HOUR = 60 * 60 * 1000;
  alertSyncTimer = setInterval(() => {
    if (!syncPaused) runAlertSync(db, "schedule").catch(() => {});
  }, HOUR);
}

export function stopScheduledSync(): void {
  if (fullSyncTimer) clearTimeout(fullSyncTimer);
  if (alertSyncTimer) clearInterval(alertSyncTimer);
}

// ── Sync status query ──────────────────────────────────────────────────────

export async function getSyncStatus(db: Pool): Promise<{
  lastFull: Record<string, unknown> | null;
  lastAlerts: Record<string, unknown> | null;
  counts: Record<string, number>;
}> {
  const [lastFull, lastAlerts, counts] = await Promise.all([
    db.query(
      `SELECT * FROM datto_sync_log WHERE triggered_by IN ('schedule','manual') ORDER BY started_at DESC LIMIT 1`
    ),
    db.query(
      `SELECT * FROM datto_sync_log ORDER BY started_at DESC LIMIT 1`
    ),
    db.query(`
      SELECT
        (SELECT COUNT(*) FROM datto_cache_sites)::int AS sites,
        (SELECT COUNT(*) FROM datto_cache_devices)::int AS devices,
        (SELECT COUNT(*) FROM datto_cache_device_audit)::int AS devices_audited,
        (SELECT COUNT(*) FROM datto_cache_device_software)::int AS software_entries,
        (SELECT COUNT(*) FROM datto_cache_devices WHERE device_class = 'esxihost')::int AS esxi_hosts,
        (SELECT COUNT(*) FROM datto_cache_devices WHERE device_class = 'printer')::int AS printers,
        (SELECT COUNT(*) FROM datto_cache_alerts WHERE resolved = false)::int AS open_alerts,
        (SELECT COUNT(*) FROM datto_cache_alerts WHERE resolved = true)::int AS resolved_alerts,
        (SELECT COUNT(*) FROM datto_cache_users)::int AS users,
        (SELECT COUNT(*) FROM datto_cache_components)::int AS components,
        (SELECT COUNT(*) FROM datto_cache_filters WHERE filter_type = 'default')::int AS default_filters,
        (SELECT COUNT(*) FROM datto_cache_filters WHERE filter_type = 'custom')::int AS custom_filters
    `),
  ]);

  return {
    lastFull: (lastFull.rows[0] as Record<string, unknown>) ?? null,
    lastAlerts: (lastAlerts.rows[0] as Record<string, unknown>) ?? null,
    counts: counts.rows[0] as Record<string, number>,
  };
}
