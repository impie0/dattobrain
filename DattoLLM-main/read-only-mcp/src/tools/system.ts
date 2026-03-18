import type { ToolDef } from "../api.js";
import { success, error } from "../api.js";

export const systemTools: ToolDef[] = [
  {
    name: "get-system-status",
    description: "Get the Datto RMM API system status",
    inputSchema: { type: "object", properties: {} },
    handler: async (api) => {
      try {
        const data = await api.get("/v2/system/status");
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error fetching system status: ${e instanceof Error ? e.message : e}`);
      }
    },
  },
  {
    name: "get-rate-limit",
    description: "Get the current API rate limit status for your account",
    inputSchema: { type: "object", properties: {} },
    handler: async (api) => {
      try {
        const data = await api.get("/v2/system/request_rate");
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error fetching rate limit: ${e instanceof Error ? e.message : e}`);
      }
    },
  },
  {
    name: "get-pagination-config",
    description: "Get the pagination configuration (default and max page sizes)",
    inputSchema: { type: "object", properties: {} },
    handler: async (api) => {
      try {
        const data = await api.get("/v2/system/pagination");
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error fetching pagination config: ${e instanceof Error ? e.message : e}`);
      }
    },
  },
];
