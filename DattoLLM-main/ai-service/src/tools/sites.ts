import type { ToolDef } from "./shared.js";
import { PAGE_PROPS, SITE_UID } from "./shared.js";

export const siteTools: ToolDef[] = [
  {
    name: "get-site",
    description: "Get detailed information about a specific site",
    inputSchema: { type: "object", properties: { ...SITE_UID }, required: ["siteUid"] },
  },
  {
    name: "list-site-devices",
    description: "List all devices in a specific site",
    inputSchema: {
      type: "object",
      properties: { ...SITE_UID, ...PAGE_PROPS, filterId: { type: "number", description: "Apply a device filter" } },
      required: ["siteUid"],
    },
  },
  {
    name: "list-site-open-alerts",
    description: "List open alerts for a specific site",
    inputSchema: {
      type: "object",
      properties: { ...SITE_UID, ...PAGE_PROPS, muted: { type: "boolean", description: "Filter by muted status" } },
      required: ["siteUid"],
    },
  },
  {
    name: "list-site-resolved-alerts",
    description: "List resolved alerts for a specific site",
    inputSchema: {
      type: "object",
      properties: { ...SITE_UID, ...PAGE_PROPS, muted: { type: "boolean", description: "Filter by muted status" } },
      required: ["siteUid"],
    },
  },
  {
    name: "list-site-variables",
    description: "List variables for a specific site",
    inputSchema: {
      type: "object",
      properties: { ...SITE_UID, ...PAGE_PROPS },
      required: ["siteUid"],
    },
  },
  {
    name: "get-site-settings",
    description: "Get settings for a specific site (including proxy configuration)",
    inputSchema: { type: "object", properties: { ...SITE_UID }, required: ["siteUid"] },
  },
  {
    name: "list-site-filters",
    description: "List device filters for a specific site",
    inputSchema: {
      type: "object",
      properties: { ...SITE_UID, ...PAGE_PROPS },
      required: ["siteUid"],
    },
  },
];
