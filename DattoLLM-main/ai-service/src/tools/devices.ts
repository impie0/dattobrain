import type { ToolDef } from "./shared.js";
import { PAGE_PROPS, DEVICE_UID } from "./shared.js";

export const deviceTools: ToolDef[] = [
  {
    name: "get-device",
    description: "Get detailed information about a specific device by its UID",
    inputSchema: {
      type: "object",
      properties: { ...DEVICE_UID },
      required: ["deviceUid"],
    },
  },
  {
    name: "get-device-by-id",
    description: "Get device information by its numeric ID",
    inputSchema: {
      type: "object",
      properties: { deviceId: { type: "number", description: "The numeric ID of the device" } },
      required: ["deviceId"],
    },
  },
  {
    name: "get-device-by-mac",
    description: "Find devices by MAC address (format: XXXXXXXXXXXX, no colons)",
    inputSchema: {
      type: "object",
      properties: { macAddress: { type: "string", description: "MAC address without separators" } },
      required: ["macAddress"],
    },
  },
  {
    name: "list-device-open-alerts",
    description: "List open alerts for a specific device",
    inputSchema: {
      type: "object",
      properties: {
        ...DEVICE_UID,
        ...PAGE_PROPS,
        muted: { type: "boolean", description: "Filter by muted status" },
      },
      required: ["deviceUid"],
    },
  },
  {
    name: "list-device-resolved-alerts",
    description: "List resolved alerts for a specific device",
    inputSchema: {
      type: "object",
      properties: {
        ...DEVICE_UID,
        ...PAGE_PROPS,
        muted: { type: "boolean", description: "Filter by muted status" },
      },
      required: ["deviceUid"],
    },
  },
];
