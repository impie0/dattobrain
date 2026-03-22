/**
 * All API calls go to the API gateway (APISIX) only — never directly to backend services.
 * Base URL is the gateway (e.g. same origin when proxied, or NEXT_PUBLIC_API_URL).
 */

const API_BASE =
  typeof window !== "undefined"
    ? (process.env.NEXT_PUBLIC_API_URL ?? "")
    : process.env.API_URL ?? "http://apisix:9080";

function getToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function login(username: string, password: string): Promise<{ token: string }> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Login failed");
  }
  return res.json();
}

export async function chat(question: string, sessionId?: string | null, dataMode?: "cached" | "live"): Promise<{ conversation_id: string; answer: string }> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (sessionId) headers["X-Session-Id"] = sessionId;
  const body: Record<string, string> = { question };
  if (dataMode) body.data_mode = dataMode;
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Chat failed");
  }
  return res.json();
}

export interface HistoryItem {
  id: string;
  question: string;
  answer: string | null;
  status: string;
  model: string;
  created_at: string;
  completed_at: string | null;
}

export async function getHistory(limit?: number, offset?: number): Promise<{
  items: HistoryItem[];
  limit: number;
  offset: number;
}> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const params = new URLSearchParams();
  if (limit != null) params.set("limit", String(limit));
  if (offset != null) params.set("offset", String(offset));
  const q = params.toString();
  const res = await fetch(`${API_BASE}/api/history${q ? `?${q}` : ""}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to load history");
  return res.json();
}

export async function getHistoryItem(id: string): Promise<{
  id: string;
  question: string;
  answer: string | null;
  status: string;
  created_at: string;
  completed_at: string | null;
}> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/history/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to load conversation");
  return res.json();
}

export interface ToolCallTrace {
  name: string;
  args: Record<string, unknown>;
  resultPreview: string;
  durationMs: number;
}

export interface ChatTrace {
  id: string;
  timestamp: string;
  userId: string;
  role: string;
  question: string;
  allowedTools: string[];
  toolCalls: ToolCallTrace[];
  answer: string;
  mockMode: boolean;
}

export interface UserTool {
  tool_name: string;
  description: string | null;
  risk_level: string;
  approval_required: boolean;
}

export async function getMyTools(): Promise<UserTool[]> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/tools`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to load tools");
  return res.json();
}

export async function getTraces(): Promise<ChatTrace[]> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/debug/traces`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to load traces");
  return res.json();
}

export interface AdminUser {
  id: string;
  username: string;
  email: string;
  role: string;
  is_active: boolean;
  approval_authority: string[];
  created_at: string;
}

export interface AdminTool {
  tool_name: string;
  permission: string;
  approval_required: boolean;
  risk_level: string;
  description: string | null;
}

export interface ApprovalRequest {
  id: string;
  tool_name: string;
  parameters: Record<string, unknown>;
  status: string;
  risk_level: string | null;
  created_at: string;
  approved_at: string | null;
  requested_by?: string;
  approved_by_name: string | null;
}

// User-facing approvals (own requests + approvable requests)
export async function getMyApprovals(): Promise<ApprovalRequest[]> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/approvals/mine`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to load approvals");
  return res.json();
}

export async function getApprovableRequests(): Promise<ApprovalRequest[]> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/approvals/approvable`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to load approvable requests");
  return res.json();
}

export async function approveUserRequest(id: string): Promise<void> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/approvals/${id}/approve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Failed to approve");
  }
}

export async function rejectUserRequest(id: string): Promise<void> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/approvals/${id}/reject`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Failed to reject");
  }
}

export async function changeUserPassword(userId: string, password: string): Promise<void> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/admin/users/${userId}/password`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Failed to change password");
  }
}

export interface AdminRole {
  role: string;
  tools: string[];
}

export async function getAdminRoles(): Promise<AdminRole[]> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/admin/roles`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to load roles");
  return res.json();
}

export async function saveAdminRole(role: string, tools: string[]): Promise<void> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/admin/roles/${encodeURIComponent(role)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ tools }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Failed to save role");
  }
}

export async function deleteAdminRole(role: string): Promise<void> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/admin/roles/${encodeURIComponent(role)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Failed to delete role");
  }
}

export async function createAdminUser(data: {
  username: string;
  email: string;
  password: string;
  role: string;
}): Promise<{ id: string }> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Failed to create user");
  }
  return res.json();
}

export async function getUserTools(userId: string): Promise<string[]> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/admin/users/${userId}/tools`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to load user tools");
  return res.json();
}

export async function setUserTools(userId: string, tools: string[]): Promise<void> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/admin/users/${userId}/tools`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ tools }),
  });
  if (!res.ok) throw new Error("Failed to update user tools");
}

export async function getAdminUsers(): Promise<AdminUser[]> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/admin/users`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to load users");
  return res.json();
}

export async function updateAdminUser(id: string, data: { role?: string; is_active?: boolean; approval_authority?: string[] }): Promise<void> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/admin/users/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update user");
}

export async function getAdminTools(): Promise<AdminTool[]> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/admin/tools`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to load tools");
  return res.json();
}

export async function updateAdminTool(toolName: string, data: { approval_required?: boolean; risk_level?: string }): Promise<void> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/admin/tools/${encodeURIComponent(toolName)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update tool policy");
}

export async function getApprovals(status?: string): Promise<ApprovalRequest[]> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const params = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await fetch(`${API_BASE}/api/admin/approvals${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to load approvals");
  return res.json();
}

export async function approveRequest(id: string): Promise<void> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/admin/approvals/${id}/approve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to approve request");
}

export interface LlmLogSummary {
  id: string;
  session_id: string;
  username: string | null;
  tool_names: string[];
  tools_called: string[];
  orchestrator_model: string | null;
  synthesizer_model: string | null;
  message_count: number;
  system_prompt_preview: string;
  created_at: string;
}

export async function getLlmLogs(limit?: number): Promise<LlmLogSummary[]> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const params = limit ? `?limit=${limit}` : "";
  const res = await fetch(`${API_BASE}/api/admin/llm-logs${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to load LLM logs");
  return res.json();
}

// ── Data sync ──────────────────────────────────────────────────────────────

export async function getSyncStatus(): Promise<unknown> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/admin/sync/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to load sync status");
  return res.json();
}

export async function triggerSync(type: "full" | "alerts"): Promise<void> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/admin/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type }),
  });
  if (!res.ok) throw new Error("Failed to trigger sync");
}

export async function pauseSync(): Promise<void> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/admin/sync/pause`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to pause sync");
}

export async function resumeSync(): Promise<void> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/admin/sync/resume`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to resume sync");
}

export async function setDataMode(sessionId: string, mode: "cached" | "live"): Promise<void> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/chat/mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ session_id: sessionId, mode }),
  });
  if (!res.ok) throw new Error("Failed to set data mode");
}

// ── Data Browser ───────────────────────────────────────────────────────────

export interface BrowserOverview {
  counts: {
    sites: number; devices: number; devices_online: number; devices_offline: number;
    workstations: number; esxi_hosts: number; printers: number;
    open_alerts: number; resolved_alerts: number; critical_alerts: number; high_alerts: number;
    users: number; audited_devices: number; software_entries: number;
  };
  topSites: { uid: string; name: string; device_count: number; online_count: number; offline_count: number }[];
  lastSync: { status: string; started_at: string; completed_at: string | null; sites_synced: number; devices_synced: number; audit_errors: number; error: string | null } | null;
}

export interface BrowserSite {
  uid: string; id: number; name: string; description: string | null;
  on_demand: boolean; device_count: number | null; online_count: number | null; offline_count: number | null;
  autotask_company_name: string | null; synced_at: string;
}

export interface BrowserDevice {
  uid: string; hostname: string; site_uid: string | null; site_name: string | null;
  device_class: string | null; device_type: string | null; operating_system: string | null;
  display_version: string | null; online: boolean | null; reboot_required: boolean | null;
  last_seen: string | null; int_ip_address: string | null; av_status: string | null; patch_status: string | null;
}

export interface BrowserAlert {
  alert_uid: string; device_uid: string | null; device_name: string | null;
  site_uid: string | null; site_name: string | null;
  alert_message: string; priority: string | null; resolved: boolean;
  muted: boolean; alert_timestamp: string | null; resolved_at: string | null;
}

async function browserGet(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const q = params ? "?" + new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => [k, String(v)])
  ).toString() : "";
  const res = await fetch(`${API_BASE}/api/admin/browser/${path}${q}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Browser API error: ${res.status}`);
  return res.json();
}

export async function getBrowserOverview(): Promise<BrowserOverview> {
  return browserGet("overview") as Promise<BrowserOverview>;
}

export async function getBrowserSites(params: { search?: string; page?: number; pageSize?: number } = {}): Promise<{ sites: BrowserSite[]; total: number; page: number; pageSize: number }> {
  return browserGet("sites", params as Record<string, string | number | undefined>) as Promise<{ sites: BrowserSite[]; total: number; page: number; pageSize: number }>;
}

export async function getBrowserSite(uid: string): Promise<{ site: BrowserSite & Record<string, unknown>; devices: BrowserDevice[]; alerts: BrowserAlert[]; variables: { name: string; value: string; masked: boolean }[] }> {
  return browserGet(`sites/${encodeURIComponent(uid)}`) as Promise<{ site: BrowserSite & Record<string, unknown>; devices: BrowserDevice[]; alerts: BrowserAlert[]; variables: { name: string; value: string; masked: boolean }[] }>;
}

export async function getBrowserDevices(params: { siteUid?: string; hostname?: string; online?: string; deviceClass?: string; os?: string; page?: number; pageSize?: number } = {}): Promise<{ devices: BrowserDevice[]; total: number; page: number; pageSize: number }> {
  return browserGet("devices", params as Record<string, string | number | undefined>) as Promise<{ devices: BrowserDevice[]; total: number; page: number; pageSize: number }>;
}

export async function getBrowserDevice(uid: string): Promise<{ device: Record<string, unknown>; alerts: BrowserAlert[] }> {
  return browserGet(`devices/${encodeURIComponent(uid)}`) as Promise<{ device: Record<string, unknown>; alerts: BrowserAlert[] }>;
}

export async function getBrowserDeviceSoftware(uid: string, params: { search?: string; page?: number; pageSize?: number } = {}): Promise<{ software: { name: string; version: string | null; publisher: string | null; install_date: string | null }[]; total: number; page: number; pageSize: number }> {
  return browserGet(`devices/${encodeURIComponent(uid)}/software`, params as Record<string, string | number | undefined>) as Promise<{ software: { name: string; version: string | null; publisher: string | null; install_date: string | null }[]; total: number; page: number; pageSize: number }>;
}

export async function getBrowserAlerts(params: { resolved?: string; siteUid?: string; priority?: string; search?: string; page?: number; pageSize?: number } = {}): Promise<{ alerts: BrowserAlert[]; total: number; page: number; pageSize: number }> {
  return browserGet("alerts", params as Record<string, string | number | undefined>) as Promise<{ alerts: BrowserAlert[]; total: number; page: number; pageSize: number }>;
}

// ── Observability ───────────────────────────────────────────────────────────

export interface ObsSeries { t: string; v: number }

export interface ObsOverview {
  requests:       { last5m: number; last1h: number; last24h: number };
  activeSessions: number;
  tokens:         { last24h: number; avg: number };
  toolCalls:      { last5m: number; last1h: number };
  errors:         { last1h: number; last24h: number };
  cacheMode:      Record<string, number>;
  series: {
    requests:  ObsSeries[];
    toolCalls: ObsSeries[];
    errors:    ObsSeries[];
  };
}

export interface ObsLlmRow {
  id: string; created_at: string;
  orchestrator_model: string | null; synthesizer_model: string | null;
  orchestrator_provider: string | null; synth_provider: string | null;
  data_mode: string | null;
  orch_prompt_tokens: number | null; orch_completion_tokens: number | null; orch_total_tokens: number | null;
  orch_iterations: number | null;
  synth_prompt_tokens: number | null; synth_completion_tokens: number | null; synth_total_tokens: number | null;
  total_tokens: number | null; tool_result_chars: number | null;
  prequery_hit: boolean | null; prequery_tool: string | null;
  tools_called: string[]; username: string | null;
}
export interface ObsLlm {
  summary: {
    total: number; total24h: number;
    tokens24h: number; orchTokens24h: number; synthTokens24h: number;
    avgTokens: number; avgOrchTokens: number; avgSynthTokens: number;
    prequeryHits24h: number; avgIterations: number;
  };
  byOrchModel:  { model: string; count: number; tokens: number; avgTokens: number }[];
  bySynthModel: { model: string; count: number; tokens: number; avgTokens: number }[];
  byProvider:   { provider: string; stage: string; count: number; tokens: number }[];
  tokenSeries:  { t: string; total: number; orch: number; synth: number }[];
  recent:       ObsLlmRow[];
}

export interface LlmLogDetail {
  id: string; session_id: string; created_at: string;
  orchestrator_model: string | null; synthesizer_model: string | null;
  system_prompt: string | null;
  messages: unknown[];
  tools_payload: unknown[];
  tool_names: string[]; tools_called: string[];
  data_mode: string | null;
  orch_prompt_tokens: number | null; orch_completion_tokens: number | null; orch_total_tokens: number | null;
  synth_prompt_tokens: number | null; synth_completion_tokens: number | null; synth_total_tokens: number | null;
  total_tokens: number | null; orch_iterations: number | null; tool_result_chars: number | null;
  username: string | null;
}

export async function getLlmLogDetail(id: string): Promise<LlmLogDetail | null> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/admin/llm-logs?id=${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export interface ObsToolRow {
  id: string; tool_name: string | null; event_type: string;
  created_at: string; metadata: Record<string, unknown>; username: string | null;
}
export interface ObsTools {
  topTools:   { tool_name: string; calls: number; errors: number; error_rate: number }[];
  callSeries: ObsSeries[];
  recent:     ObsToolRow[];
}

export interface ObsMcpErrorRow {
  tool_name: string | null; event_type: string; created_at: string;
  metadata: Record<string, unknown>; username: string | null;
}
export interface ObsMcp {
  health:       { status: string; checked_at: string };
  stats:        { calls1h: number; calls5m: number; errors1h: number; denied1h: number; errorRate: number };
  errSeries:    ObsSeries[];
  recentErrors: ObsMcpErrorRow[];
  topDenied:    { tool_name: string; count: number }[];
}

export interface ObsChatSession {
  id: string; data_mode: string; updated_at: string;
  username: string | null; message_count: number;
}
export interface ObsChat {
  summary:        { sessions24h: number; messages24h: number; active15m: number; avgMsgsPerSession: number };
  msgSeries:      ObsSeries[];
  activeSessions: ObsChatSession[];
}

export interface ObsSyncRow {
  id: string; started_at: string; completed_at: string | null;
  triggered_by: string; status: string; sites_synced: number;
  devices_synced: number; alerts_open_synced: number;
  audit_errors: number; duration_secs: number | null;
  error: string | null; last_api_error: string | null;
}
export interface ObsCache {
  syncHistory: ObsSyncRow[];
  modeDistrib: Record<string, number>;
  tableCounts: { name: string; count: number }[];
}

async function obsGet(path: string): Promise<unknown> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/admin/observability/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Observability API error: ${res.status}`);
  return res.json();
}

export async function getObsOverview(): Promise<ObsOverview> {
  return obsGet("overview") as Promise<ObsOverview>;
}
export async function getObsLlm(): Promise<ObsLlm> {
  return obsGet("llm") as Promise<ObsLlm>;
}
export async function getObsTools(): Promise<ObsTools> {
  return obsGet("tools") as Promise<ObsTools>;
}
export async function getObsMcp(): Promise<ObsMcp> {
  return obsGet("mcp") as Promise<ObsMcp>;
}
export async function getObsChat(): Promise<ObsChat> {
  return obsGet("chat") as Promise<ObsChat>;
}
export async function getObsCache(): Promise<ObsCache> {
  return obsGet("cache") as Promise<ObsCache>;
}

// ── Request Traces ───────────────────────────────────────────────────────

export interface TraceListItem {
  id: string;
  sessionId: string | null;
  userId: string | null;
  username: string | null;
  question: string | null;
  status: string;
  toolCount: number;
  totalDurationMs: number | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  spanCount: number;
}

export interface TraceSpanNode {
  id: string;
  traceId: string;
  parentSpanId: string | null;
  service: string;
  operation: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  requestPayload: unknown;
  responsePayload: unknown;
  metadata: Record<string, unknown> | null;
  errorMessage: string | null;
  children: TraceSpanNode[];
}

export interface TraceDetail {
  trace: TraceListItem;
  spans: TraceSpanNode[];
}

export async function getTraceList(params?: { page?: number; pageSize?: number; search?: string; status?: string }): Promise<{ traces: TraceListItem[]; total: number; page: number; pageSize: number }> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const q = params ? "?" + new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])
  ).toString() : "";
  const res = await fetch(`${API_BASE}/api/admin/observability/traces${q}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Traces API error: ${res.status}`);
  return res.json();
}

export async function getTraceDetail(traceId: string): Promise<TraceDetail> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/admin/observability/traces/${encodeURIComponent(traceId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Trace detail API error: ${res.status}`);
  return res.json();
}

export async function rejectRequest(id: string): Promise<void> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/admin/approvals/${id}/reject`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to reject request");
}

// ── LLM Routing Config ────────────────────────────────────────────────────────

export interface LlmRoutingConfigItem {
  key: string;
  model: string;
  description: string | null;
}

export interface LlmModel {
  id: string;
  label: string;
  provider: string;
  canOrchestrate: boolean;
}

export async function getLlmConfig(): Promise<{ items: LlmRoutingConfigItem[] }> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/admin/llm-config`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to load LLM config");
  return res.json();
}

export async function putLlmConfig(updates: { key: string; model: string }[]): Promise<void> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/admin/llm-config`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ updates }),
  });
  if (!res.ok) throw new Error("Failed to save LLM config");
}

export async function getLlmModels(): Promise<{ models: LlmModel[] }> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/admin/llm-config/models`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to load models");
  return res.json();
}

// ── Vulnerability Scanner ─────────────────────────────────────────────────

export interface VulnSummary {
  totals: { total: number; critical: number; high: number; medium: number; low: number };
  topSoftware: { name: string; cve_count: number; device_count: number; worst_score: number }[];
  topSites: { site_name: string; device_count: number; critical_count: number; high_count: number }[];
  lastSync: { status: string; started_at: string; completed_at: string | null; cves_added: number; matches_found: number; error: string | null } | null;
}

export async function getVulnSummary(): Promise<VulnSummary> {
  return browserGet("vulnerabilities/summary") as Promise<VulnSummary>;
}

export interface VulnMatch {
  hostname: string; site_name: string;
  software_name: string; software_version: string | null;
  cve_id: string; cvss_v3_score: number | null; severity: string;
  match_confidence: number; found_at: string; description: string | null;
}

export async function getVulnList(params: {
  page?: number; pageSize?: number; severity?: string;
  site?: string; device?: string; software?: string; search?: string;
} = {}): Promise<{ vulnerabilities: VulnMatch[]; total: number; page: number; pageSize: number }> {
  return browserGet("vulnerabilities", params as Record<string, string | number | undefined>) as Promise<{ vulnerabilities: VulnMatch[]; total: number; page: number; pageSize: number }>;
}

export async function getDeviceVulns(uid: string): Promise<{
  vulnerabilities: VulnMatch[];
  summary: { critical: number; high: number; medium: number; low: number };
}> {
  return browserGet(`devices/${encodeURIComponent(uid)}/vulnerabilities`) as Promise<{
    vulnerabilities: VulnMatch[];
    summary: { critical: number; high: number; medium: number; low: number };
  }>;
}

export async function triggerCveScan(): Promise<{ started: boolean }> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/admin/cve-scan`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to trigger CVE scan");
  return res.json();
}

export async function getCveScanStatus(): Promise<{
  cves: number; cpes: number; matches: number;
  bySeverity: Record<string, number>;
  lastSync: { status: string; started_at: string; completed_at: string | null; matches_found: number } | null;
}> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/admin/cve-scan/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to get CVE scan status");
  return res.json();
}

