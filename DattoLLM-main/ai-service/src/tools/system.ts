import type { ToolDef } from "./shared.js";

export const systemTools: ToolDef[] = [
  {
    name: "get-system-status",
    description: "Get the Datto RMM API system status",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get-rate-limit",
    description: "Get the current API rate limit status for your account",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get-pagination-config",
    description: "Get the pagination configuration (default and max page sizes)",
    inputSchema: { type: "object", properties: {} },
  },
];
