/**
 * Tool registry — all 37 MCP tool definitions, assembled from domain modules.
 * ARCH-002: split from monolithic toolRegistry.ts to keep each domain independently
 * maintainable as the tool count grows (especially when write tools are added in Phase 1).
 */

export type { ToolDef } from "./shared.js";
export { accountTools } from "./account.js";
export { siteTools } from "./sites.js";
export { deviceTools } from "./devices.js";
export { alertTools } from "./alerts.js";
export { jobTools } from "./jobs.js";
export { auditTools } from "./audit.js";
export { activityTools } from "./activity.js";
export { filterTools } from "./filters.js";
export { systemTools } from "./system.js";

import { accountTools } from "./account.js";
import { siteTools } from "./sites.js";
import { deviceTools } from "./devices.js";
import { alertTools } from "./alerts.js";
import { jobTools } from "./jobs.js";
import { auditTools } from "./audit.js";
import { activityTools } from "./activity.js";
import { filterTools } from "./filters.js";
import { systemTools } from "./system.js";

/** Full flat registry — same array shape as the old toolRegistry.ts export. */
export const toolRegistry = [
  ...accountTools,
  ...siteTools,
  ...deviceTools,
  ...alertTools,
  ...jobTools,
  ...auditTools,
  ...activityTools,
  ...filterTools,
  ...systemTools,
];
