export interface ToolDef {
  name: string;
  description: string;
  inputSchema: object;
}

const PAGE_PROPS = {
  page: { type: "number", description: "Page number" },
  max: { type: "number", description: "Results per page (max 250)" },
};

const SITE_UID = {
  siteUid: { type: "string", description: "The unique ID (UID) of the site — use list-sites first to find this value if you only have a site name" },
};

const DEVICE_UID = {
  deviceUid: { type: "string", description: "The unique ID (UID) of the device — use list-devices or list-site-devices first to find this value if you only have a hostname" },
};

const JOB_UID = {
  jobUid: { type: "string", description: "The unique ID (UID) of the job — NOTE: there is no tool to list jobs; the user must provide this from the Datto RMM portal" },
};

export const toolRegistry: ToolDef[] = [
  // ── Account ────────────────────────────────────────────────────────────────
  {
    name: "get-account",
    description: "Get information about the authenticated Datto RMM account, including device status summary",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list-sites",
    description: "List all sites in the Datto RMM account. Supports pagination and filtering by site name.",
    inputSchema: {
      type: "object",
      properties: {
        ...PAGE_PROPS,
        siteName: { type: "string", description: "Filter by site name (server-side contains-match — returns sites whose name includes this string; omit to list all sites)" },
      },
    },
  },
  {
    name: "list-devices",
    description: "List all devices in the account. Supports filtering by hostname, site, device type, and OS.",
    inputSchema: {
      type: "object",
      properties: {
        ...PAGE_PROPS,
        hostname: { type: "string", description: "Filter by hostname (server-side contains-match)" },
        siteName: { type: "string", description: "Filter by site name (server-side contains-match — returns devices at sites whose name includes this string)" },
        deviceType: { type: "string", description: "Filter by device type" },
        operatingSystem: { type: "string", description: "Filter by OS (partial match)" },
        filterId: { type: "number", description: "Apply a device filter by ID" },
      },
    },
  },
  {
    name: "list-users",
    description: "List all users in the Datto RMM account",
    inputSchema: { type: "object", properties: { ...PAGE_PROPS } },
  },
  {
    name: "list-account-variables",
    description: "List all account-level variables",
    inputSchema: { type: "object", properties: { ...PAGE_PROPS } },
  },
  {
    name: "list-components",
    description: "List all available job components in the account",
    inputSchema: { type: "object", properties: { ...PAGE_PROPS } },
  },
  {
    name: "list-open-alerts",
    description: "List all open (unresolved) alerts across the entire account",
    inputSchema: {
      type: "object",
      properties: {
        ...PAGE_PROPS,
        muted: { type: "boolean", description: "Filter by muted status" },
      },
    },
  },
  {
    name: "list-resolved-alerts",
    description: "List resolved alerts across the account",
    inputSchema: {
      type: "object",
      properties: {
        ...PAGE_PROPS,
        muted: { type: "boolean", description: "Filter by muted status" },
      },
    },
  },

  // ── Sites ──────────────────────────────────────────────────────────────────
  {
    name: "get-site",
    description: "Get detailed information about a specific site",
    inputSchema: { type: "object", properties: { ...SITE_UID }, required: ["siteUid"] },
  },
  {
    name: "list-site-devices",
    description: "List all devices in a specific site",
    inputSchema: {
      type: "object",
      properties: { ...SITE_UID, ...PAGE_PROPS, filterId: { type: "number", description: "Apply a device filter" } },
      required: ["siteUid"],
    },
  },
  {
    name: "list-site-open-alerts",
    description: "List open alerts for a specific site",
    inputSchema: {
      type: "object",
      properties: { ...SITE_UID, ...PAGE_PROPS, muted: { type: "boolean", description: "Filter by muted status" } },
      required: ["siteUid"],
    },
  },
  {
    name: "list-site-resolved-alerts",
    description: "List resolved alerts for a specific site",
    inputSchema: {
      type: "object",
      properties: { ...SITE_UID, ...PAGE_PROPS, muted: { type: "boolean", description: "Filter by muted status" } },
      required: ["siteUid"],
    },
  },
  {
    name: "list-site-variables",
    description: "List variables for a specific site",
    inputSchema: {
      type: "object",
      properties: { ...SITE_UID, ...PAGE_PROPS },
      required: ["siteUid"],
    },
  },
  {
    name: "get-site-settings",
    description: "Get settings for a specific site (including proxy configuration)",
    inputSchema: { type: "object", properties: { ...SITE_UID }, required: ["siteUid"] },
  },
  {
    name: "list-site-filters",
    description: "List device filters for a specific site",
    inputSchema: {
      type: "object",
      properties: { ...SITE_UID, ...PAGE_PROPS },
      required: ["siteUid"],
    },
  },

  // ── Devices ────────────────────────────────────────────────────────────────
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

  // ── Alerts ─────────────────────────────────────────────────────────────────
  {
    name: "get-alert",
    description: "Get detailed information about a specific alert",
    inputSchema: {
      type: "object",
      properties: { alertUid: { type: "string", description: "The unique ID (UID) of the alert — use list-open-alerts, list-resolved-alerts, list-site-open-alerts, or list-device-open-alerts first to find this value" } },
      required: ["alertUid"],
    },
  },

  // ── Jobs ───────────────────────────────────────────────────────────────────
  {
    name: "get-job",
    description: "Get status of a specific job (returns only 'active' or 'completed' — use get-job-results for detailed execution output). NOTE: there is no tool to list jobs; the user must provide the jobUid from the Datto RMM portal.",
    inputSchema: {
      type: "object",
      properties: { ...JOB_UID },
      required: ["jobUid"],
    },
  },
  {
    name: "get-job-components",
    description: "Get the components of a job. NOTE: there is no tool to list jobs; the user must provide the jobUid from the Datto RMM portal.",
    inputSchema: {
      type: "object",
      properties: { ...JOB_UID, ...PAGE_PROPS },
      required: ["jobUid"],
    },
  },
  {
    name: "get-job-results",
    description: "Get job execution results for a specific device. Returns jobDeploymentStatus and componentResults[] with hasStdOut/hasStdErr flags — check these before calling stdout/stderr tools. NOTE: there is no tool to list jobs; the user must provide the jobUid from the Datto RMM portal.",
    inputSchema: {
      type: "object",
      properties: {
        ...JOB_UID,
        deviceUid: { type: "string", description: "The unique ID (UID) of the device — use list-devices to find this. Check hasStdOut/hasStdErr in the results before calling stdout/stderr tools" },
      },
      required: ["jobUid", "deviceUid"],
    },
  },
  {
    name: "get-job-stdout",
    description: "Get the stdout output from a job execution. Only call this when get-job-results shows hasStdOut=true for the component. NOTE: there is no tool to list jobs; the user must provide the jobUid from the Datto RMM portal.",
    inputSchema: {
      type: "object",
      properties: {
        ...JOB_UID,
        deviceUid: { type: "string", description: "The unique ID (UID) of the device — use list-devices to find this. Check hasStdOut/hasStdErr in get-job-results before calling stdout/stderr tools" },
      },
      required: ["jobUid", "deviceUid"],
    },
  },
  {
    name: "get-job-stderr",
    description: "Get the stderr output from a job execution. Only call this when get-job-results shows hasStdErr=true for the component. NOTE: there is no tool to list jobs; the user must provide the jobUid from the Datto RMM portal.",
    inputSchema: {
      type: "object",
      properties: {
        ...JOB_UID,
        deviceUid: { type: "string", description: "The unique ID (UID) of the device — use list-devices to find this. Check hasStdOut/hasStdErr in get-job-results before calling stdout/stderr tools" },
      },
      required: ["jobUid", "deviceUid"],
    },
  },

  // ── Audit ──────────────────────────────────────────────────────────────────
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

  // ── Activity ───────────────────────────────────────────────────────────────
  {
    name: "get-activity-logs",
    description: "Get activity logs with filtering options. Returns logs from last 15 minutes by default.",
    inputSchema: {
      type: "object",
      properties: {
        size: { type: "number", description: "Number of records to return" },
        order: { type: "string", enum: ["asc", "desc"], description: "Sort order by creation date" },
        from: { type: "string", description: "Start date (UTC, format: YYYY-MM-DDTHH:mm:ssZ)" },
        until: { type: "string", description: "End date (UTC, format: YYYY-MM-DDTHH:mm:ssZ)" },
        entities: { type: "array", items: { type: "string" }, description: "Filter by entity type (device, user)" },
        categories: { type: "array", items: { type: "string" }, description: "Filter by category" },
        actions: { type: "array", items: { type: "string" }, description: "Filter by action" },
        siteIds: { type: "array", items: { type: "number" }, description: "Filter by site IDs" },
        userIds: { type: "array", items: { type: "number" }, description: "Filter by user IDs" },
      },
    },
  },

  // ── Filters ────────────────────────────────────────────────────────────────
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

  // ── System ─────────────────────────────────────────────────────────────────
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
