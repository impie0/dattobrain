import type { ToolDef } from "../api.js";
import { success, error } from "../api.js";

const PAGE_PROPS = {
  page: { type: "number", description: "Page number" },
  max: { type: "number", description: "Results per page (max 250)" },
};

export const deviceTools: ToolDef[] = [
  {
    name: "get-device",
    description: "Get detailed information about a specific device by its UID",
    inputSchema: {
      type: "object",
      properties: { deviceUid: { type: "string", description: "The unique ID (UID) of the device — use list-devices or list-site-devices first to find this value if you only have a hostname" } },
      required: ["deviceUid"],
    },
    handler: async (api, args) => {
      try {
        const data = await api.get(`/v2/device/${args["deviceUid"]}`);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error fetching device: ${e instanceof Error ? e.message : e}`);
      }
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
    handler: async (api, args) => {
      try {
        const data = await api.get(`/v2/device/id/${args["deviceId"]}`);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error fetching device: ${e instanceof Error ? e.message : e}`);
      }
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
    handler: async (api, args) => {
      try {
        const data = await api.get(`/v2/device/macAddress/${args["macAddress"]}`);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error fetching device: ${e instanceof Error ? e.message : e}`);
      }
    },
  },
  {
    name: "list-device-open-alerts",
    description: "List open alerts for a specific device",
    inputSchema: {
      type: "object",
      properties: {
        deviceUid: { type: "string", description: "The unique ID (UID) of the device — use list-devices or list-site-devices first to find this value if you only have a hostname" },
        ...PAGE_PROPS,
        muted: { type: "boolean", description: "Filter by muted status" },
      },
      required: ["deviceUid"],
    },
    handler: async (api, args) => {
      try {
        const { deviceUid, ...query } = args;
        const data = await api.get(`/v2/device/${deviceUid}/alerts/open`, query);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error listing device alerts: ${e instanceof Error ? e.message : e}`);
      }
    },
  },
  {
    name: "list-device-resolved-alerts",
    description: "List resolved alerts for a specific device",
    inputSchema: {
      type: "object",
      properties: {
        deviceUid: { type: "string", description: "The unique ID (UID) of the device — use list-devices or list-site-devices first to find this value if you only have a hostname" },
        ...PAGE_PROPS,
        muted: { type: "boolean", description: "Filter by muted status" },
      },
      required: ["deviceUid"],
    },
    handler: async (api, args) => {
      try {
        const { deviceUid, ...query } = args;
        const data = await api.get(`/v2/device/${deviceUid}/alerts/resolved`, query);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error listing device resolved alerts: ${e instanceof Error ? e.message : e}`);
      }
    },
  },
];
