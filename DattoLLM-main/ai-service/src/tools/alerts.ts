import type { ToolDef } from "./shared.js";

export const alertTools: ToolDef[] = [
  {
    name: "get-alert",
    description: "Get detailed information about a specific alert",
    inputSchema: {
      type: "object",
      properties: { alertUid: { type: "string", description: "The unique ID (UID) of the alert — use list-open-alerts, list-resolved-alerts, list-site-open-alerts, or list-device-open-alerts first to find this value" } },
      required: ["alertUid"],
    },
  },
];
