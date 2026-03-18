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
    description: "List all open (unresolved) alerts across the entire account",
    inputSchema: {
      type: "object",
      properties: {
        ...PAGE_PROPS,
        muted: { type: "boolean", description: "Filter by muted status" },
      },
    },
  },
  {
    name: "list-resolved-alerts",
    description: "List resolved alerts across the account",
    inputSchema: {
      type: "object",
      properties: {
        ...PAGE_PROPS,
        muted: { type: "boolean", description: "Filter by muted status" },
      },
    },
  },
  {
    name: "list-sites",
    description: "List all sites in the Datto RMM account. Supports pagination and filtering by site name.",
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
    description: "List all devices in the account. Supports filtering by hostname, site, device type, and OS.",
    inputSchema: {
      type: "object",
      properties: {
        ...PAGE_PROPS,
        hostname: { type: "string", description: "Filter by hostname (server-side contains-match)" },
        siteName: { type: "string", description: "Filter by site name (server-side contains-match — returns devices at sites whose name includes this string)" },
        deviceType: { type: "string", description: "Filter by device type" },
        operatingSystem: { type: "string", description: "Filter by OS (partial match)" },
        filterId: { type: "number", description: "Apply a device filter by ID" },
      },
    },
  },
];
