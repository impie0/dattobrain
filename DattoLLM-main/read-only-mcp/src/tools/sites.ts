import type { ToolDef } from "../api.js";
import { success, error } from "../api.js";

const PAGE_PROPS = {
  page: { type: "number", description: "Page number" },
  max: { type: "number", description: "Results per page (max 250)" },
};

const SITE_UID = {
  siteUid: { type: "string", description: "The unique ID (UID) of the site — use list-sites first to find this value if you only have a site name" },
};

export const siteTools: ToolDef[] = [
  {
    name: "get-site",
    description: "Get detailed information about a specific site",
    inputSchema: { type: "object", properties: { ...SITE_UID }, required: ["siteUid"] },
    handler: async (api, args) => {
      try {
        const data = await api.get(`/v2/site/${args["siteUid"]}`);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error fetching site: ${e instanceof Error ? e.message : e}`);
      }
    },
  },
  {
    name: "list-site-devices",
    description: "List all devices in a specific site",
    inputSchema: {
      type: "object",
      properties: { ...SITE_UID, ...PAGE_PROPS, filterId: { type: "number", description: "Apply a device filter" } },
      required: ["siteUid"],
    },
    handler: async (api, args) => {
      try {
        const { siteUid, ...query } = args;
        const data = await api.get(`/v2/site/${siteUid}/devices`, query);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error listing site devices: ${e instanceof Error ? e.message : e}`);
      }
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
    handler: async (api, args) => {
      try {
        const { siteUid, ...query } = args;
        const data = await api.get(`/v2/site/${siteUid}/alerts/open`, query);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error listing site open alerts: ${e instanceof Error ? e.message : e}`);
      }
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
    handler: async (api, args) => {
      try {
        const { siteUid, ...query } = args;
        const data = await api.get(`/v2/site/${siteUid}/alerts/resolved`, query);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error listing site resolved alerts: ${e instanceof Error ? e.message : e}`);
      }
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
    handler: async (api, args) => {
      try {
        const { siteUid, ...query } = args;
        const data = await api.get(`/v2/site/${siteUid}/variables`, query);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error listing site variables: ${e instanceof Error ? e.message : e}`);
      }
    },
  },
  {
    name: "get-site-settings",
    description: "Get settings for a specific site (including proxy configuration)",
    inputSchema: { type: "object", properties: { ...SITE_UID }, required: ["siteUid"] },
    handler: async (api, args) => {
      try {
        const data = await api.get(`/v2/site/${args["siteUid"]}/settings`);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error fetching site settings: ${e instanceof Error ? e.message : e}`);
      }
    },
  },
  {
    name: "list-site-filters",
    description: "List device filters for a specific site",
    inputSchema: {
      type: "object",
      properties: { ...SITE_UID, ...PAGE_PROPS },
      required: ["siteUid"],
    },
    handler: async (api, args) => {
      try {
        const { siteUid, ...query } = args;
        const data = await api.get(`/v2/site/${siteUid}/filters`, query);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error listing site filters: ${e instanceof Error ? e.message : e}`);
      }
    },
  },
];
