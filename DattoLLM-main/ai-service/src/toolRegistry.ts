/**
 * ARCH-002: This file is now a thin re-export shim.
 * Tool definitions live in ./tools/ — one file per domain:
 *   tools/account.ts  — account, users, variables, components, list-sites, list-devices, account-level alerts
 *   tools/sites.ts    — site detail, site devices, site alerts, site variables/settings/filters
 *   tools/devices.ts  — device detail, by-id, by-mac, device-level alerts
 *   tools/alerts.ts   — get-alert
 *   tools/jobs.ts     — get-job, components, results, stdout, stderr
 *   tools/audit.ts    — device/esxi/printer audits, software, audit-by-mac
 *   tools/activity.ts — get-activity-logs
 *   tools/filters.ts  — default/custom filters
 *   tools/system.ts   — system-status, rate-limit, pagination-config
 *
 * All existing imports of `toolRegistry` and `ToolDef` from this file continue to work.
 */

export type { ToolDef } from "./tools/index.js";
export { toolRegistry } from "./tools/index.js";
