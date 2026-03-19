import type { ToolDef } from "../api.js";
import { success, error } from "../api.js";

const PAGE_PROPS = {
  page: { type: "number", description: "Page number" },
  max: { type: "number", description: "Results per page (max 250)" },
};

export const accountTools: ToolDef[] = [
  {
    name: "get-account",
    description: "Get information about the authenticated Datto RMM account, including device status summary",
    inputSchema: { type: "object", properties: {} },
    handler: async (api) => {
      try {
        const data = await api.get("/v2/account");
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error fetching account: ${e instanceof Error ? e.message : e}`);
      }
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
    handler: async (api, args) => {
      try {
        const data = await api.get("/v2/account/sites", args);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error listing sites: ${e instanceof Error ? e.message : e}`);
      }
    },
  },
  {
    name: "list-devices",
    description: "List devices in the account. ALWAYS use filters (hostname, siteName, deviceType, operatingSystem) when looking for specific devices — this avoids loading all devices. Supports fuzzy matching on hostname and siteName.",
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
    handler: async (api, args) => {
      try {
        const data = await api.get("/v2/account/devices", args);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error listing devices: ${e instanceof Error ? e.message : e}`);
      }
    },
  },
  {
    name: "list-users",
    description: "List all users in the Datto RMM account",
    inputSchema: { type: "object", properties: { ...PAGE_PROPS } },
    handler: async (api, args) => {
      try {
        const data = await api.get("/v2/account/users", args);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error listing users: ${e instanceof Error ? e.message : e}`);
      }
    },
  },
  {
    name: "list-account-variables",
    description: "List all account-level variables",
    inputSchema: { type: "object", properties: { ...PAGE_PROPS } },
    handler: async (api, args) => {
      try {
        const data = await api.get("/v2/account/variables", args);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error listing account variables: ${e instanceof Error ? e.message : e}`);
      }
    },
  },
  {
    name: "list-components",
    description: "List all available job components in the account",
    inputSchema: { type: "object", properties: { ...PAGE_PROPS } },
    handler: async (api, args) => {
      try {
        const data = await api.get("/v2/account/components", args);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error listing components: ${e instanceof Error ? e.message : e}`);
      }
    },
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
    handler: async (api, args) => {
      try {
        const data = await api.get("/v2/account/alerts/open", args);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error listing open alerts: ${e instanceof Error ? e.message : e}`);
      }
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
    handler: async (api, args) => {
      try {
        const data = await api.get("/v2/account/alerts/resolved", args);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error listing resolved alerts: ${e instanceof Error ? e.message : e}`);
      }
    },
  },
];
