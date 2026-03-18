import type { ToolDef } from "../api.js";
import { success, error } from "../api.js";

const PAGE_PROPS = {
  page: { type: "number", description: "Page number" },
  max: { type: "number", description: "Results per page" },
};

export const filterTools: ToolDef[] = [
  {
    name: "list-default-filters",
    description: "List the default device filters",
    inputSchema: { type: "object", properties: { ...PAGE_PROPS } },
    handler: async (api, args) => {
      try {
        const data = await api.get("/v2/filter/default-filters", args);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error listing default filters: ${e instanceof Error ? e.message : e}`);
      }
    },
  },
  {
    name: "list-custom-filters",
    description: "List custom device filters created by users",
    inputSchema: { type: "object", properties: { ...PAGE_PROPS } },
    handler: async (api, args) => {
      try {
        const data = await api.get("/v2/filter/custom-filters", args);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error listing custom filters: ${e instanceof Error ? e.message : e}`);
      }
    },
  },
];
