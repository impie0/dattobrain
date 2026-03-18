import type { ToolDef } from "./shared.js";
import { PAGE_PROPS } from "./shared.js";

export const filterTools: ToolDef[] = [
  {
    name: "list-default-filters",
    description: "List the default device filters",
    inputSchema: { type: "object", properties: { ...PAGE_PROPS } },
  },
  {
    name: "list-custom-filters",
    description: "List custom device filters created by users",
    inputSchema: { type: "object", properties: { ...PAGE_PROPS } },
  },
];
