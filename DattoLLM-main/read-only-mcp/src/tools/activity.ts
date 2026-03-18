import type { ToolDef } from "../api.js";
import { success, error } from "../api.js";

export const activityTools: ToolDef[] = [
  {
    name: "get-activity-logs",
    description: "Get activity logs with filtering options. Returns logs from last 15 minutes by default.",
    inputSchema: {
      type: "object",
      properties: {
        size: { type: "number", description: "Number of records to return" },
        order: { type: "string", enum: ["asc", "desc"], description: "Sort order by creation date" },
        from: { type: "string", description: "Start date (UTC, format: YYYY-MM-DDTHH:mm:ssZ)" },
        until: { type: "string", description: "End date (UTC, format: YYYY-MM-DDTHH:mm:ssZ)" },
        entities: { type: "array", items: { type: "string" }, description: "Filter by entity type (device, user)" },
        categories: { type: "array", items: { type: "string" }, description: "Filter by category" },
        actions: { type: "array", items: { type: "string" }, description: "Filter by action" },
        siteIds: { type: "array", items: { type: "number" }, description: "Filter by site IDs" },
        userIds: { type: "array", items: { type: "number" }, description: "Filter by user IDs" },
      },
    },
    handler: async (api, args) => {
      try {
        const data = await api.get("/v2/activity-logs", args);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error fetching activity logs: ${e instanceof Error ? e.message : e}`);
      }
    },
  },
];
