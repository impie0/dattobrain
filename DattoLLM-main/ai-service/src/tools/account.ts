import type { ToolDef } from "./shared.js";
import { PAGE_PROPS } from "./shared.js";

export const accountTools: ToolDef[] = [
  {
    name: "get-account",
    description: "Get information about the authenticated Datto RMM account, including device status summary",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list-users",
    description: "List all users in the Datto RMM account",
    inputSchema: { type: "object", properties: { ...PAGE_PROPS } },
  },
  {
    name: "list-account-variables",
    description: "List all account-level variables",
    inputSchema: { type: "object", properties: { ...PAGE_PROPS } },
  },
  {
    name: "list-components",
    description: "List all available job components in the account",
    inputSchema: { type: "object", properties: { ...PAGE_PROPS } },
  },
  {
    name: "list-open-alerts",
    description: "List open (unresolved) alerts across the account. Returns a summary with top 10 most recent alerts and priority breakdown. For site-specific alerts use list-site-open-alerts. For device-specific alerts use list-device-open-alerts.",
    inputSchema: {
      type: "object",
      properties: {
        muted: { type: "boolean", description: "Filter by muted status" },
      },
    },
  },
  {
    name: "list-resolved-alerts",
    description: "List recently resolved alerts. Returns top 10 most recently resolved. For site-specific results use list-site-resolved-alerts.",
    inputSchema: {
      type: "object",
      properties: {
        muted: { type: "boolean", description: "Filter by muted status" },
      },
    },
  },
  {
    name: "list-sites",
    description: "List sites in the Datto RMM account. ALWAYS use the siteName filter when looking for a specific site — this avoids loading all sites. Supports fuzzy matching (handles typos). Only omit siteName when the user wants a full listing.",
    inputSchema: {
      type: "object",
      properties: {
        ...PAGE_PROPS,
        siteName: { type: "string", description: "Filter by site name (server-side contains-match — returns sites whose name includes this string; omit to list all sites)" },
      },
    },
  },
  {
    name: "list-devices",
    description: "List devices in the account. Without filters: returns accurate total/online/offline counts and OS breakdown (use this for count questions). With filters: returns matching devices (max 15). Use get-device with a deviceUid for full device details.",
    inputSchema: {
      type: "object",
      properties: {
        hostname: { type: "string", description: "Filter by hostname (fuzzy match — handles typos)" },
        siteName: { type: "string", description: "Filter by site name (fuzzy match)" },
        online: { type: "boolean", description: "Filter by online status (true=online, false=offline)" },
        deviceClass: { type: "string", description: "Filter by device class: 'device', 'esxihost', 'printer'" },
        operatingSystem: { type: "string", description: "Filter by OS (partial match, e.g. 'Windows 11', 'macOS')" },
        filterId: { type: "number", description: "Apply a device filter by ID" },
      },
    },
  },
];
