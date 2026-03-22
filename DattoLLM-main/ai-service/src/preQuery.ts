/**
 * Stage 4: Smart Pre-Query Engine
 *
 * Intercepts simple questions and answers them directly from DB/materialized views,
 * skipping the LLM entirely (0 tokens, instant response).
 *
 * Security: checks allowedTools before executing — respects RBAC.
 * Audit: logs all pre-query executions to audit_logs.
 */

import type { Pool } from "pg";

function log(level: "info" | "warn", msg: string, extra?: Record<string, unknown>) {
  process.stdout.write(JSON.stringify({ level, msg, ts: Date.now(), ...extra }) + "\n");
}

export interface PreQueryResult {
  matched: true;
  answer: string;
  toolUsed: string; // which MV/tool equivalent was used
}

interface Pattern {
  /** Regex patterns to match against user input (case-insensitive) */
  patterns: RegExp[];
  /** Tool permission required — pre-query won't run if user lacks this */
  requiresTool: string;
  /** Execute the query and return a formatted markdown answer */
  execute: (db: Pool, match: RegExpMatchArray) => Promise<string>;
}

// ── Pattern definitions ──────────────────────────────────────────────────────

const PATTERNS: Pattern[] = [
  // ── Fleet overview / summary ──────────────────────────────────────────────
  {
    patterns: [
      /\b(fleet|overall|full)\s*(overview|summary|status|health)\b/i,
      /\bgive\s*me\s*(a|the)?\s*(summary|overview|rundown)\b/i,
      /\bhow\s*(is|are)\s*(the|our|my)?\s*(fleet|environment|infrastructure)\b/i,
      /\bwhat('s| is)\s*(the|our)?\s*(current)?\s*status\b/i,
    ],
    requiresTool: "get-fleet-status",
    execute: async (db) => {
      const r = await db.query("SELECT * FROM mv_fleet_status LIMIT 1");
      if (!r.rows.length) return "No fleet data available. Run a data sync first.";
      const f = r.rows[0] as Record<string, unknown>;
      return `## Fleet Overview\n\n` +
        `| Metric | Value |\n|--------|-------|\n` +
        `| Total Devices | ${num(f.total_devices)} |\n` +
        `| Online | ${num(f.online_devices)} (${pct(f.online_devices, f.total_devices)}) |\n` +
        `| Offline | ${num(f.offline_devices)} (${pct(f.offline_devices, f.total_devices)}) |\n` +
        `| Sites | ${num(f.total_sites)} |\n` +
        `| Open Alerts | ${num(f.open_alerts)} |\n` +
        `| Resolved Alerts | ${num(f.resolved_alerts)} |\n\n` +
        `*Data last synced: devices ${ago(f.last_device_sync)}, alerts ${ago(f.last_alert_sync)}*`;
    },
  },

  // ── Device counts ─────────────────────────────────────────────────────────
  {
    patterns: [
      /\bhow\s*many\s*(total\s*)?(devices?|machines?|endpoints?|computers?)\b/i,
      /\b(total|number|count)\s*(of\s*)?(devices?|machines?|endpoints?|computers?)\b/i,
      /\bdevice\s*count\b/i,
    ],
    requiresTool: "get-fleet-status",
    execute: async (db) => {
      const r = await db.query("SELECT total_devices, online_devices, offline_devices FROM mv_fleet_status LIMIT 1");
      if (!r.rows.length) return "No device data available.";
      const f = r.rows[0] as Record<string, unknown>;
      return `You have **${num(f.total_devices)} devices** — **${num(f.online_devices)} online** and **${num(f.offline_devices)} offline**.`;
    },
  },

  // ── Online/offline devices ────────────────────────────────────────────────
  {
    patterns: [
      /\bhow\s*many\s*(devices?\s*)?(are\s*)?(online|up|connected)\b/i,
      /\b(online|connected)\s*(device|machine|endpoint)?\s*count\b/i,
    ],
    requiresTool: "get-fleet-status",
    execute: async (db) => {
      const r = await db.query("SELECT online_devices, total_devices FROM mv_fleet_status LIMIT 1");
      if (!r.rows.length) return "No data available.";
      const f = r.rows[0] as Record<string, unknown>;
      return `**${num(f.online_devices)}** of ${num(f.total_devices)} devices are online (${pct(f.online_devices, f.total_devices)}).`;
    },
  },
  {
    patterns: [
      /\bhow\s*many\s*(devices?\s*)?(are\s*)?(offline|down|disconnected)\b/i,
      /\b(offline|disconnected)\s*(device|machine|endpoint)?\s*count\b/i,
    ],
    requiresTool: "get-fleet-status",
    execute: async (db) => {
      const r = await db.query("SELECT offline_devices, total_devices FROM mv_fleet_status LIMIT 1");
      if (!r.rows.length) return "No data available.";
      const f = r.rows[0] as Record<string, unknown>;
      return `**${num(f.offline_devices)}** of ${num(f.total_devices)} devices are offline (${pct(f.offline_devices, f.total_devices)}).`;
    },
  },

  // ── Site counts ───────────────────────────────────────────────────────────
  {
    patterns: [
      /\bhow\s*many\s*(total\s*)?(sites?|locations?|offices?|branches?)\b/i,
      /\b(total|number|count)\s*(of\s*)?(sites?|locations?)\b/i,
      /\bsite\s*count\b/i,
    ],
    requiresTool: "list-sites",
    execute: async (db) => {
      const r = await db.query("SELECT total_sites FROM mv_fleet_status LIMIT 1");
      if (!r.rows.length) return "No data available.";
      return `You have **${num((r.rows[0] as Record<string, unknown>).total_sites)} sites**.`;
    },
  },

  // ── Alert counts ──────────────────────────────────────────────────────────
  {
    patterns: [
      /\bhow\s*many\s*(open|active|unresolved)?\s*alerts?\b/i,
      /\b(total|number|count)\s*(of\s*)?(open\s*)?alerts?\b/i,
      /\balert\s*count\b/i,
    ],
    requiresTool: "list-open-alerts",
    execute: async (db) => {
      const r = await db.query("SELECT open_alerts, resolved_alerts FROM mv_fleet_status LIMIT 1");
      const p = await db.query("SELECT * FROM mv_alert_priority");
      if (!r.rows.length) return "No alert data available.";
      const f = r.rows[0] as Record<string, unknown>;
      let answer = `**${num(f.open_alerts)} open alerts** and ${num(f.resolved_alerts)} resolved.\n\n`;
      if (p.rows.length) {
        answer += `| Priority | Count |\n|----------|-------|\n`;
        for (const row of p.rows) {
          const pr = row as Record<string, unknown>;
          answer += `| ${pr.priority} | ${num(pr.alert_count)} |\n`;
        }
      }
      return answer;
    },
  },

  // ── Top sites by alerts ───────────────────────────────────────────────────
  {
    patterns: [
      /\b(which|what|top)\s*(5|five|10|ten)?\s*sites?\s*(have|has|with)\s*(the\s*)?(most|highest|biggest)\s*(open\s*)?alerts?\b/i,
      /\bsites?\s*(with|by)\s*(most|highest)\s*alerts?\b/i,
      /\bbusiest\s*sites?\b/i,
    ],
    requiresTool: "list-site-summaries",
    execute: async (db) => {
      const r = await db.query(
        "SELECT site_name, device_count::int, open_alert_count::int FROM mv_site_summary ORDER BY open_alert_count DESC LIMIT 10"
      );
      if (!r.rows.length) return "No site data available.";
      let answer = `## Top Sites by Open Alerts\n\n| Site | Devices | Open Alerts |\n|------|---------|-------------|\n`;
      for (const row of r.rows) {
        const s = row as Record<string, unknown>;
        answer += `| ${s.site_name} | ${num(s.device_count)} | ${num(s.open_alert_count)} |\n`;
      }
      return answer;
    },
  },

  // ── Top sites by devices ──────────────────────────────────────────────────
  {
    patterns: [
      /\b(which|what|top)\s*(5|five|10|ten)?\s*sites?\s*(have|has|with)\s*(the\s*)?(most|highest|biggest|largest)\s*(devices?|machines?|endpoints?)\b/i,
      /\blargest\s*sites?\b/i,
      /\bbiggest\s*sites?\b/i,
    ],
    requiresTool: "list-site-summaries",
    execute: async (db) => {
      const r = await db.query(
        "SELECT site_name, device_count::int, online_count::int, open_alert_count::int FROM mv_site_summary ORDER BY device_count DESC LIMIT 10"
      );
      if (!r.rows.length) return "No site data available.";
      let answer = `## Largest Sites by Device Count\n\n| Site | Devices | Online | Alerts |\n|------|---------|--------|--------|\n`;
      for (const row of r.rows) {
        const s = row as Record<string, unknown>;
        answer += `| ${s.site_name} | ${num(s.device_count)} | ${num(s.online_count)} | ${num(s.open_alert_count)} |\n`;
      }
      return answer;
    },
  },

  // ── Critical alerts ───────────────────────────────────────────────────────
  {
    patterns: [
      /\b(what|show|list)\s*(are\s*)?(the\s*)?(critical|high\s*priority|urgent|important)\s*(alerts?|issues?|problems?)\b/i,
      /\bcritical\s*alerts?\b/i,
      /\bwhat\s*needs?\s*(immediate\s*)?attention\b/i,
      /\bwhat('s| is)\s*(most\s*)?(urgent|critical)\b/i,
    ],
    requiresTool: "list-critical-alerts",
    execute: async (db) => {
      const p = await db.query("SELECT * FROM mv_alert_priority");
      const r = await db.query("SELECT * FROM mv_critical_alerts LIMIT 10");
      let answer = `## Alert Priority Breakdown\n\n| Priority | Count | Devices | Sites |\n|----------|-------|---------|-------|\n`;
      for (const row of p.rows) {
        const pr = row as Record<string, unknown>;
        answer += `| ${pr.priority} | ${num(pr.alert_count)} | ${num(pr.affected_devices)} | ${num(pr.affected_sites)} |\n`;
      }
      if (r.rows.length) {
        answer += `\n## Top Critical/High Alerts\n\n| Hostname | Site | Priority | Time |\n|----------|------|----------|------|\n`;
        for (const row of r.rows) {
          const a = row as Record<string, unknown>;
          answer += `| ${a.hostname ?? "—"} | ${a.site_name ?? "—"} | ${a.priority} | ${fmtDate(a.alert_timestamp)} |\n`;
        }
      }
      return answer;
    },
  },

  // ── OS distribution ───────────────────────────────────────────────────────
  {
    patterns: [
      /\b(os|operating\s*system)\s*(distribution|breakdown|mix|spread|stats)\b/i,
      /\bwhat\s*(os|operating\s*systems?)\s*(are|do)\s*(we|they)\s*(have|run|use)\b/i,
      /\bhow\s*many\s*(windows|linux|mac|macos)\b/i,
    ],
    requiresTool: "list-devices",
    execute: async (db) => {
      const r = await db.query("SELECT * FROM mv_os_distribution");
      if (!r.rows.length) return "No OS data available.";
      let answer = `## OS Distribution\n\n| Operating System | Devices | Online | % |\n|-----------------|---------|--------|---|\n`;
      for (const row of r.rows) {
        const o = row as Record<string, unknown>;
        answer += `| ${o.operating_system} | ${num(o.device_count)} | ${num(o.online_count)} | ${o.percentage}% |\n`;
      }
      return answer;
    },
  },

  // ── Last sync time ────────────────────────────────────────────────────────
  {
    patterns: [
      /\bwhen\s*(was|did)\s*(the\s*)?(last|latest|most\s*recent)\s*(data\s*)?(sync|update|refresh)\b/i,
      /\b(last|latest)\s*sync\s*(time|date|status)?\b/i,
      /\bis\s*(the\s*)?(data|cache)\s*(fresh|stale|up\s*to\s*date|current)\b/i,
    ],
    requiresTool: "get-fleet-status",
    execute: async (db) => {
      const r = await db.query("SELECT last_device_sync, last_alert_sync, refreshed_at FROM mv_fleet_status LIMIT 1");
      if (!r.rows.length) return "No sync data available.";
      const f = r.rows[0] as Record<string, unknown>;
      return `**Last sync times:**\n- Devices: ${fmtDate(f.last_device_sync)} (${ago(f.last_device_sync)})\n- Alerts: ${fmtDate(f.last_alert_sync)} (${ago(f.last_alert_sync)})\n- Views refreshed: ${fmtDate(f.refreshed_at)} (${ago(f.refreshed_at)})`;
    },
  },

  // ── Specific site lookup ──────────────────────────────────────────────────
  {
    patterns: [
      /\bhow\s*many\s*(devices?|alerts?)\s*(does|at|for|in)\s+(.+?)(\s*(have|site))?\s*\??\s*$/i,
      /\b(tell|show)\s*me\s*about\s*(site\s+)?(.+?)\s*site\b/i,
    ],
    requiresTool: "list-site-summaries",
    execute: async (db, match) => {
      const siteName = (match[3] ?? "").trim().replace(/['"]/g, "");
      if (!siteName || siteName.length < 2) return "";
      const r = await db.query(
        `SELECT site_name, device_count::int, online_count::int, offline_count::int, open_alert_count::int
         FROM mv_site_summary WHERE site_name ILIKE $1 ORDER BY device_count DESC LIMIT 5`,
        [`%${siteName}%`]
      );
      if (!r.rows.length) return ""; // No match — fall through to LLM
      let answer = `| Site | Devices | Online | Offline | Alerts |\n|------|---------|--------|---------|--------|\n`;
      for (const row of r.rows) {
        const s = row as Record<string, unknown>;
        answer += `| ${s.site_name} | ${num(s.device_count)} | ${num(s.online_count)} | ${num(s.offline_count)} | ${num(s.open_alert_count)} |\n`;
      }
      return answer;
    },
  },
];

// ── Helper functions ─────────────────────────────────────────────────────────

function num(v: unknown): string {
  const n = Number(v);
  return isNaN(n) ? String(v) : n.toLocaleString("en-US");
}

function pct(part: unknown, total: unknown): string {
  const p = Number(part), t = Number(total);
  if (!t) return "0%";
  return `${((p / t) * 100).toFixed(1)}%`;
}

function ago(v: unknown): string {
  if (!v) return "unknown";
  const ms = Date.now() - new Date(String(v)).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function fmtDate(v: unknown): string {
  if (!v) return "—";
  return new Date(String(v)).toISOString().replace("T", " ").slice(0, 19);
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Try to answer the user's question directly from materialized views / DB.
 * Returns null if no pattern matches — caller should fall through to LLM.
 *
 * Security: checks allowedTools before executing.
 * Audit: logs successful pre-query executions.
 */
export async function tryPreQuery(
  question: string,
  allowedTools: string[],
  userId: string,
  db: Pool
): Promise<PreQueryResult | null> {
  const q = question.trim();
  if (q.length < 5 || q.length > 500) return null; // Too short or too long to pattern match

  for (const pattern of PATTERNS) {
    for (const regex of pattern.patterns) {
      const match = q.match(regex);
      if (!match) continue;

      // RBAC check — user must have the required tool permission
      if (!allowedTools.includes(pattern.requiresTool)) {
        log("warn", "prequery_denied", { pattern: regex.source.slice(0, 50), tool: pattern.requiresTool, userId });
        return null; // Don't reveal what patterns exist — just fall through to LLM
      }

      try {
        const answer = await pattern.execute(db, match);
        if (!answer) continue; // Empty answer = pattern matched but no data, try next or fall through

        // Audit log
        db.query(
          "INSERT INTO audit_logs (user_id, event_type, tool_name, metadata) VALUES ($1, $2, $3, $4)",
          [userId, "prequery", pattern.requiresTool, JSON.stringify({ pattern: regex.source.slice(0, 80) })]
        ).catch(() => {});

        log("info", "prequery_hit", { tool: pattern.requiresTool, userId, questionLength: q.length });

        return {
          matched: true,
          answer,
          toolUsed: pattern.requiresTool,
        };
      } catch (err) {
        log("warn", "prequery_error", { error: String(err), pattern: regex.source.slice(0, 50) });
        return null; // On error, fall through to LLM
      }
    }
  }

  return null; // No pattern matched
}
