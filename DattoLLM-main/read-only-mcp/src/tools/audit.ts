import type { ToolDef } from "../api.js";
import { success, error } from "../api.js";

const PAGE_PROPS = {
  page: { type: "number", description: "Page number" },
  max: { type: "number", description: "Results per page" },
};

export const auditTools: ToolDef[] = [
  {
    name: "get-device-audit",
    description: "Get hardware/system audit for a generic device. ONLY works when deviceClass='device' — use list-devices first to check deviceClass before calling this tool",
    inputSchema: {
      type: "object",
      properties: { deviceUid: { type: "string", description: "The unique ID (UID) of the device — use list-devices to find; check deviceClass='device' before calling" } },
      required: ["deviceUid"],
    },
    handler: async (api, args) => {
      try {
        const data = await api.get(`/v2/audit/device/${args["deviceUid"]}`);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error fetching device audit: ${e instanceof Error ? e.message : e}`);
      }
    },
  },
  {
    name: "get-device-software",
    description: "Get installed software list for a generic device. ONLY works when deviceClass='device' — use list-devices first to check deviceClass before calling this tool",
    inputSchema: {
      type: "object",
      properties: {
        deviceUid: { type: "string", description: "The unique ID (UID) of the device — use list-devices to find; check deviceClass='device' before calling" },
        ...PAGE_PROPS,
      },
      required: ["deviceUid"],
    },
    handler: async (api, args) => {
      try {
        const { deviceUid, ...query } = args;
        const data = await api.get(`/v2/audit/device/${deviceUid}/software`, query);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error fetching device software: ${e instanceof Error ? e.message : e}`);
      }
    },
  },
  {
    name: "get-device-audit-by-mac",
    description: "Get audit data by MAC address. ONLY works when deviceClass='device'. Returns an ARRAY (multiple devices may share a MAC address).",
    inputSchema: {
      type: "object",
      properties: { macAddress: { type: "string", description: "MAC address, NO separators, exactly 12 hex chars — e.g. A1B2C3D4E5F6" } },
      required: ["macAddress"],
    },
    handler: async (api, args) => {
      try {
        const data = await api.get(`/v2/audit/device/macAddress/${args["macAddress"]}`);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error fetching device audit: ${e instanceof Error ? e.message : e}`);
      }
    },
  },
  {
    name: "get-esxi-audit",
    description: "Get ESXi host audit including VMs and datastores. ONLY works when deviceClass='esxihost' — use list-devices first to check deviceClass before calling this tool",
    inputSchema: {
      type: "object",
      properties: { deviceUid: { type: "string", description: "The unique ID (UID) of the ESXi host device — use list-devices to find; check deviceClass='esxihost' before calling" } },
      required: ["deviceUid"],
    },
    handler: async (api, args) => {
      try {
        const data = await api.get(`/v2/audit/esxihost/${args["deviceUid"]}`);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error fetching ESXi audit: ${e instanceof Error ? e.message : e}`);
      }
    },
  },
  {
    name: "get-printer-audit",
    description: "Get printer audit including supply levels. ONLY works when deviceClass='printer' — use list-devices first to check deviceClass before calling this tool",
    inputSchema: {
      type: "object",
      properties: { deviceUid: { type: "string", description: "The unique ID (UID) of the printer device — use list-devices to find; check deviceClass='printer' before calling" } },
      required: ["deviceUid"],
    },
    handler: async (api, args) => {
      try {
        const data = await api.get(`/v2/audit/printer/${args["deviceUid"]}`);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error fetching printer audit: ${e instanceof Error ? e.message : e}`);
      }
    },
  },
];
