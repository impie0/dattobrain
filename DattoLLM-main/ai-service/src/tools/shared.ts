/** Shared input schema fragments used across tool definitions. */

export const PAGE_PROPS = {
  page: { type: "number", description: "Page number" },
  max: { type: "number", description: "Results per page (max 250)" },
};

export const SITE_UID = {
  siteUid: { type: "string", description: "The unique ID (UID) of the site — use list-sites first to find this value if you only have a site name" },
};

export const DEVICE_UID = {
  deviceUid: { type: "string", description: "The unique ID (UID) of the device — use list-devices or list-site-devices first to find this value if you only have a hostname" },
};

export const JOB_UID = {
  jobUid: { type: "string", description: "The unique ID (UID) of the job — NOTE: there is no tool to list jobs; the user must provide this from the Datto RMM portal" },
};

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: object;
}
