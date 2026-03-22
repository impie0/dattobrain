/**
 * Vulnerability Browser — admin-only REST endpoints for exploring CVE matches.
 * All routes require x-user-role: admin (enforced in index.ts before calling these).
 */

import type { Request, Response } from "express";
import type { Pool } from "pg";

// ── Summary ───────────────────────────────────────────────────────────────

export async function handleVulnSummary(req: Request, res: Response, db: Pool) {
  try {
    const totals = await db.query(`
      SELECT
        COUNT(*)::int                                                          AS total,
        COUNT(*) FILTER (WHERE severity = 'CRITICAL')::int                     AS critical,
        COUNT(*) FILTER (WHERE severity = 'HIGH')::int                         AS high,
        COUNT(*) FILTER (WHERE severity = 'MEDIUM')::int                       AS medium,
        COUNT(*) FILTER (WHERE severity = 'LOW')::int                          AS low
      FROM device_vulnerabilities
    `);

    const topSoftware = await db.query(`
      SELECT
        m.software_name                                     AS name,
        COUNT(DISTINCT m.cve_id)::int                       AS cve_count,
        COUNT(DISTINCT m.device_uid)::int                   AS device_count,
        MAX(c.cvss_v3_score)                                   AS worst_score
      FROM device_vulnerabilities m
      LEFT JOIN cve_database c ON c.cve_id = m.cve_id
      GROUP BY m.software_name
      ORDER BY cve_count DESC
      LIMIT 10
    `);

    const topSites = await db.query(`
      SELECT
        d.site_name,
        COUNT(DISTINCT m.device_uid)::int                                      AS device_count,
        COUNT(*) FILTER (WHERE m.severity = 'CRITICAL')::int                   AS critical_count,
        COUNT(*) FILTER (WHERE m.severity = 'HIGH')::int                       AS high_count
      FROM device_vulnerabilities m
      JOIN datto_cache_devices d ON d.uid = m.device_uid
      GROUP BY d.site_name
      ORDER BY device_count DESC
      LIMIT 10
    `);

    const lastSync = await db.query(`
      SELECT status, started_at, completed_at, cves_added, matches_found, error
      FROM cve_sync_log
      ORDER BY started_at DESC LIMIT 1
    `);

    res.json({
      totals: totals.rows[0],
      topSoftware: topSoftware.rows,
      topSites: topSites.rows,
      lastSync: lastSync.rows[0] ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

// ── Vulnerability List ────────────────────────────────────────────────────

export async function handleVulnList(req: Request, res: Response, db: Pool) {
  try {
    const page = Math.max(1, Number(req.query["page"] ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query["pageSize"] ?? 50)));
    const offset = (page - 1) * pageSize;

    const severity = req.query["severity"] as string | undefined;
    const site = req.query["site"] as string | undefined;
    const device = req.query["device"] as string | undefined;
    const software = req.query["software"] as string | undefined;
    const search = req.query["search"] as string | undefined;

    // Build WHERE clause with separate parameter arrays for list vs count queries
    const filterConditions: string[] = [];
    const filterValues: unknown[] = [];
    let fi = 1;

    if (severity) { filterConditions.push(`m.severity = $${fi++}`); filterValues.push(severity); }
    if (site) { filterConditions.push(`d.site_name ILIKE $${fi++}`); filterValues.push(`%${site}%`); }
    if (device) { filterConditions.push(`d.hostname ILIKE $${fi++}`); filterValues.push(`%${device}%`); }
    if (software) { filterConditions.push(`m.software_name ILIKE $${fi++}`); filterValues.push(`%${software}%`); }
    if (search) { filterConditions.push(`(m.cve_id ILIKE $${fi} OR c.description ILIKE $${fi})`); filterValues.push(`%${search}%`); fi++; }

    const where = filterConditions.length ? `WHERE ${filterConditions.join(" AND ")}` : "";

    // Count query — uses $1..$N for filter params only
    const total = await db.query(
      `SELECT COUNT(*)::int AS count
       FROM device_vulnerabilities m
       JOIN datto_cache_devices d ON d.uid = m.device_uid
       LEFT JOIN cve_database c ON c.cve_id = m.cve_id
       ${where}`,
      filterValues
    );

    // List query — append LIMIT/OFFSET as next params
    const listParams = [...filterValues, pageSize, offset];
    const limitParam = `$${fi++}`;
    const offsetParam = `$${fi++}`;

    const r = await db.query(
      `SELECT
         d.hostname, d.uid AS device_uid, d.site_name, d.site_uid,
         m.software_name, m.software_version,
         m.cve_id, c.cvss_v3_score, m.severity, m.match_confidence, m.found_at,
         LEFT(c.description, 200) AS description
       FROM device_vulnerabilities m
       JOIN datto_cache_devices d ON d.uid = m.device_uid
       LEFT JOIN cve_database c ON c.cve_id = m.cve_id
       ${where}
       ORDER BY c.cvss_v3_score DESC NULLS LAST, m.found_at DESC
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      listParams
    );

    res.json({
      vulnerabilities: r.rows,
      total: (total.rows[0] as { count: number }).count,
      page,
      pageSize,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

// ── Device Vulnerabilities ────────────────────────────────────────────────

export async function handleDeviceVulns(req: Request, res: Response, db: Pool) {
  const { uid } = req.params;
  try {
    const r = await db.query(
      `SELECT
         m.software_name, m.software_version, m.cve_id,
         c.cvss_v3_score, m.severity, c.description, m.match_confidence
       FROM device_vulnerabilities m
       LEFT JOIN cve_database c ON c.cve_id = m.cve_id
       WHERE m.device_uid = $1
       ORDER BY c.cvss_v3_score DESC NULLS LAST`,
      [uid]
    );

    const summary = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE severity = 'CRITICAL')::int AS critical,
         COUNT(*) FILTER (WHERE severity = 'HIGH')::int     AS high,
         COUNT(*) FILTER (WHERE severity = 'MEDIUM')::int   AS medium,
         COUNT(*) FILTER (WHERE severity = 'LOW')::int      AS low
       FROM device_vulnerabilities
       WHERE device_uid = $1`,
      [uid]
    );

    res.json({
      vulnerabilities: r.rows,
      summary: summary.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

// ── Software Autocomplete + Categories ────────────────────────────────────

export async function handleVulnSoftwareList(req: Request, res: Response, db: Pool) {
  const q = (req.query["q"] as string ?? "").trim();
  try {
    // If search query provided, return matching software names
    if (q.length >= 2) {
      const r = await db.query(
        `SELECT software_name AS name, COUNT(DISTINCT cve_id)::int AS cves, COUNT(DISTINCT device_uid)::int AS devices, cpe_vendor AS vendor
         FROM device_vulnerabilities
         WHERE software_name ILIKE $1
         GROUP BY software_name, cpe_vendor
         ORDER BY devices DESC
         LIMIT 20`,
        [`%${q}%`]
      );
      res.json({ results: r.rows });
      return;
    }

    // No query — return all software grouped by vendor (category)
    const r = await db.query(
      `SELECT cpe_vendor AS vendor, software_name AS name, COUNT(DISTINCT cve_id)::int AS cves, COUNT(DISTINCT device_uid)::int AS devices
       FROM device_vulnerabilities
       GROUP BY cpe_vendor, software_name
       ORDER BY cpe_vendor, devices DESC`
    );

    // Group by vendor
    const categories: Record<string, { name: string; cves: number; devices: number }[]> = {};
    for (const row of r.rows as { vendor: string; name: string; cves: number; devices: number }[]) {
      const vendor = row.vendor || "other";
      if (!categories[vendor]) categories[vendor] = [];
      categories[vendor].push({ name: row.name, cves: row.cves, devices: row.devices });
    }

    res.json({ categories });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

// ── CVE Scan Trigger ──────────────────────────────────────────────────────

export async function handleCveScanTrigger(req: Request, res: Response, _db: Pool) {
  try {
    const r = await fetch("http://cve-scanner:8500/scan", { method: "POST" });
    if (!r.ok) {
      res.status(r.status).json({ started: false, error: await r.text() });
      return;
    }
    res.json({ started: true });
  } catch (err) {
    res.status(502).json({ started: false, error: "cve-scanner unavailable", detail: String(err) });
  }
}

// ── CVE Scan Status ───────────────────────────────────────────────────────

export async function handleCveScanStatus(req: Request, res: Response, _db: Pool) {
  try {
    const r = await fetch("http://cve-scanner:8500/status");
    if (!r.ok) {
      res.status(r.status).json({ error: await r.text() });
      return;
    }
    const body = await r.json();
    res.json(body);
  } catch (err) {
    res.status(502).json({ error: "cve-scanner unavailable", detail: String(err) });
  }
}
