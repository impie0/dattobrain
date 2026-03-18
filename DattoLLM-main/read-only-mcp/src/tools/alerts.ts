import type { ToolDef } from "../api.js";
import { success, error } from "../api.js";

export const alertTools: ToolDef[] = [
  {
    name: "get-alert",
    description: "Get detailed information about a specific alert",
    inputSchema: {
      type: "object",
      properties: { alertUid: { type: "string", description: "The unique ID (UID) of the alert — use list-open-alerts, list-resolved-alerts, list-site-open-alerts, or list-device-open-alerts first to find this value" } },
      required: ["alertUid"],
    },
    handler: async (api, args) => {
      try {
        const data = await api.get(`/v2/alert/${args["alertUid"]}`);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error fetching alert: ${e instanceof Error ? e.message : e}`);
      }
    },
  },
];
