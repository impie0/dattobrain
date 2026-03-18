import type { ToolDef } from "./shared.js";
import { PAGE_PROPS } from "./shared.js";

export const auditTools: ToolDef[] = [
  {
    name: "get-device-audit",
    description: "Get hardware/system audit for a generic device. ONLY works when deviceClass='device' — use list-devices first to check deviceClass before calling this tool",
    inputSchema: {
      type: "object",
      properties: { deviceUid: { type: "string", description: "The unique ID (UID) of the device — use list-devices to find; check deviceClass='device' before calling" } },
      required: ["deviceUid"],
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
  },
  {
    name: "get-device-audit-by-mac",
    description: "Get audit data by MAC address. ONLY works when deviceClass='device'. Returns an ARRAY (multiple devices may share a MAC address).",
    inputSchema: {
      type: "object",
      properties: { macAddress: { type: "string", description: "MAC address, NO separators, exactly 12 hex chars — e.g. A1B2C3D4E5F6" } },
      required: ["macAddress"],
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
  },
  {
    name: "get-printer-audit",
    description: "Get printer audit including supply levels. ONLY works when deviceClass='printer' — use list-devices first to check deviceClass before calling this tool",
    inputSchema: {
      type: "object",
      properties: { deviceUid: { type: "string", description: "The unique ID (UID) of the printer device — use list-devices to find; check deviceClass='printer' before calling" } },
      required: ["deviceUid"],
    },
  },
];
