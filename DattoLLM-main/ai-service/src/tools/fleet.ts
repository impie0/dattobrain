import type { ToolDef } from "./shared.js";

/** Stage 3: Tools backed by materialized views — instant answers, zero LLM cost for simple questions */
export const fleetTools: ToolDef[] = [
  {
    name: "get-fleet-status",
    description: "Get a complete fleet overview in a single call: total devices, online/offline counts, site count, alert counts, last sync times. Use this FIRST for any 'how many' or 'fleet overview' or 'summary' questions — it replaces multiple tool calls with one.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list-site-summaries",
    description: "Get a compact summary of ALL sites with device counts and alert counts per site. Use this for site comparisons, finding busiest sites, or answering 'which site has the most alerts/devices'. Much more efficient than calling list-sites + list-site-devices for each site.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list-critical-alerts",
    description: "Get the top 20 highest-priority open alerts (Critical first, then High) with device and site info, plus a priority breakdown showing counts per severity level. Use this for security posture or 'what needs attention' questions.",
    inputSchema: { type: "object", properties: {} },
  },
];
