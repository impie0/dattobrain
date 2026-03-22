import express from "express";
import cors from "cors";
import { handleChat } from "./chat.js";
import { handleLegacyChat, handleHistory, handleTools, handleSetDataMode } from "./legacyChat.js";
import {
  handleAdminGetUsers, handleAdminCreateUser, handleAdminUpdateUser,
  handleAdminChangePassword, handleAdminGetUserTools, handleAdminSetUserTools,
  handleAdminGetRoles, handleAdminSaveRole, handleAdminDeleteRole,
  handleAdminGetTools, handleAdminUpdateTool,
  handleAdminGetApprovals, handleAdminApproveRequest, handleAdminRejectRequest,
  handleAdminGetLlmConfig, handleAdminPutLlmConfig, handleAdminGetLlmModels,
} from "./admin.js";
import {
  handleGetMyApprovals, handleGetApprovable,
  handleUserApprove, handleUserReject,
} from "./approvals.js";
import {
  handleStageProposal, handleListProposals,
  handleConfirmProposal, handleRejectProposal, handleExecuteProposal,
} from "./actionProposals.js";
import { pool } from "./db.js";
import { runSync, runAlertSync, getSyncStatus, startScheduledSync, pauseSync, resumeSync, isSyncPaused } from "./sync.js";
import {
  handleBrowserOverview, handleBrowserSites, handleBrowserSite,
  handleBrowserDevices, handleBrowserDevice, handleBrowserDeviceSoftware,
  handleBrowserAlerts,
} from "./dataBrowser.js";
import {
  handleObsOverview, handleObsLlm, handleObsTools,
  handleObsMcp, handleObsChat, handleObsCache,
} from "./observability.js";
import {
  handleListTraces, handleGetTrace, handleIngestSpans,
} from "./traceHandlers.js";
import {
  handleVulnSummary, handleVulnList, handleDeviceVulns,
  handleVulnSoftwareList, handleCveScanTrigger, handleCveScanStatus,
} from "./vulnBrowser.js";

function log(level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>) {
  const line = JSON.stringify({ level, msg, ts: Date.now(), ...extra });
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

function validateEnv() {
  for (const key of ["DATABASE_URL", "MCP_BRIDGE_URL", "EMBEDDING_SERVICE_URL"]) {
    if (!process.env[key]) {
      log("error", `Missing required environment variable: ${key}`);
      process.exit(1);
    }
  }
  // SEC-007: LiteLLM without a master key leaves /v1 open to any container on
  // the internal network — an API credit exfiltration risk. If LITELLM_URL is
  // set, LITELLM_MASTER_KEY must also be set.
  if (process.env["LITELLM_URL"] && !process.env["LITELLM_MASTER_KEY"]) {
    log("error", "LITELLM_URL is set but LITELLM_MASTER_KEY is empty. Set LITELLM_MASTER_KEY to secure the LiteLLM gateway. See SECURITY_FINDINGS.md SEC-007.");
    process.exit(1);
  }
}

validateEnv();

const app = express();
app.use(cors());
app.use(express.json());

// ── SEC: Per-user rate limiting for chat endpoints ──────────────────────────
const chatRateMap = new Map<string, { count: number; resetAt: number }>();
function chatRateLimit(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const userId = req.headers["x-user-id"] as string;
  if (!userId) { next(); return; }
  const now = Date.now();
  let entry = chatRateMap.get(userId);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + 60_000 }; // 1-minute window
    chatRateMap.set(userId, entry);
  }
  entry.count++;
  if (entry.count > 10) { // 10 requests/minute per user
    res.status(429).json({ error: "Rate limit exceeded. Max 10 chat requests per minute." });
    return;
  }
  next();
}
// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of chatRateMap) { if (now > v.resetAt) chatRateMap.delete(k); }
}, 300_000);

// ── Legacy chat & history ──────────────────────────────────────────────────
app.post("/api/chat", chatRateLimit, handleLegacyChat);
app.post("/api/chat/mode", handleSetDataMode);
app.get("/api/history", handleHistory);
app.get("/api/history/:id", async (req, res) => {
  const userId = req.headers["x-user-id"] as string | undefined;
  if (!userId) { res.status(401).json({ error: "missing x-user-id" }); return; }
  try {
    const result = await pool.query(
      `SELECT s.id, m_user.content AS question, m_asst.content AS answer,
              'completed' AS status, 'claude-opus-4-6' AS model,
              s.created_at, s.updated_at AS completed_at
       FROM chat_sessions s
       JOIN chat_messages m_user ON m_user.session_id = s.id AND m_user.role = 'user'
       JOIN chat_messages m_asst ON m_asst.session_id = s.id AND m_asst.role = 'assistant'
       WHERE s.id = $1 AND s.user_id = $2
       LIMIT 1`,
      [req.params["id"], userId]
    );
    if (!result.rows[0]) { res.status(404).json({ error: "not_found" }); return; }
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to load conversation" });
  }
});

// ── Tools ──────────────────────────────────────────────────────────────────
app.get("/api/tools", handleTools);

// ── Debug traces ───────────────────────────────────────────────────────────
app.get("/api/debug/traces", async (req, res) => {
  const userId = req.headers["x-user-id"] as string | undefined;
  if (!userId) { res.status(401).json({ error: "missing x-user-id" }); return; }
  try {
    const result = await pool.query(
      `SELECT s.id, s.created_at AS timestamp, s.user_id,
              m_user.content AS question,
              m_asst.content AS answer,
              m_asst.tools_used
       FROM chat_sessions s
       LEFT JOIN LATERAL (SELECT content FROM chat_messages WHERE session_id = s.id AND role = 'user'      ORDER BY created_at ASC  LIMIT 1) m_user ON true
       LEFT JOIN LATERAL (SELECT content, tools_used FROM chat_messages WHERE session_id = s.id AND role = 'assistant' ORDER BY created_at DESC LIMIT 1) m_asst ON true
       WHERE s.user_id = $1 AND m_user.content IS NOT NULL
       ORDER BY s.created_at DESC
       LIMIT 20`,
      [userId]
    );
    const traces = result.rows.map((r: Record<string, unknown>) => ({
      id: r["id"],
      timestamp: r["timestamp"],
      userId: r["user_id"],
      role: "user",
      question: r["question"] ?? "",
      allowedTools: [] as string[],
      toolCalls: ((r["tools_used"] as string[]) ?? []).map((name: string) => ({
        name,
        args: {},
        resultPreview: "",
        durationMs: 0,
      })),
      answer: r["answer"] ?? "",
      mockMode: false,
    }));
    res.json(traces);
  } catch {
    res.json([]);
  }
});

// ── User approvals ─────────────────────────────────────────────────────────
app.get("/api/approvals/mine", handleGetMyApprovals);
app.get("/api/approvals/approvable", handleGetApprovable);
app.post("/api/approvals/:id/approve", handleUserApprove);
app.post("/api/approvals/:id/reject", handleUserReject);

// ── Write tool ActionProposals (SEC-Write-001) ─────────────────────────────
// Stage → confirm/reject → execute state machine for write tool operations.
// Proposals expire after 15 minutes if not confirmed.
app.get("/api/proposals",                  (req, res) => handleListProposals(req, res, pool));
app.post("/api/proposals",                 (req, res) => handleStageProposal(req, res, pool));
app.post("/api/proposals/:id/confirm",     (req, res) => handleConfirmProposal(req, res, pool));
app.post("/api/proposals/:id/reject",      (req, res) => handleRejectProposal(req, res, pool));
app.post("/api/proposals/:id/execute",     (req, res) => handleExecuteProposal(req, res, pool));

// ── Admin — forced logout (SEC-008) ────────────────────────────────────────
// Proxies to auth-service /auth/revoke — revokes all active JTIs for the user
app.post("/api/admin/users/:id/revoke", async (req, res) => {
  const userRole = req.headers["x-user-role"] as string | undefined;
  if (userRole !== "admin") { res.status(403).json({ error: "admin only" }); return; }
  const authServiceUrl = process.env["AUTH_SERVICE_URL"] ?? "http://auth-service:5001";
  try {
    const r = await fetch(`${authServiceUrl}/auth/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: req.params["id"] }),
    });
    const body = await r.json();
    res.status(r.status).json(body);
  } catch (err) {
    res.status(502).json({ error: "auth-service unavailable", detail: String(err) });
  }
});

// ── Admin — users ──────────────────────────────────────────────────────────
app.get("/api/admin/users", adminOnly, handleAdminGetUsers);
app.post("/api/admin/users", adminOnly, handleAdminCreateUser);
app.patch("/api/admin/users/:id", adminOnly, handleAdminUpdateUser);
app.patch("/api/admin/users/:id/password", adminOnly, handleAdminChangePassword);
app.get("/api/admin/users/:id/tools", adminOnly, handleAdminGetUserTools);
app.put("/api/admin/users/:id/tools", adminOnly, handleAdminSetUserTools);

// ── Admin — roles ──────────────────────────────────────────────────────────
app.get("/api/admin/roles", adminOnly, handleAdminGetRoles);
app.put("/api/admin/roles/:role", adminOnly, handleAdminSaveRole);
app.delete("/api/admin/roles/:role", adminOnly, handleAdminDeleteRole);

// ── Admin — tools ──────────────────────────────────────────────────────────
app.get("/api/admin/tools", adminOnly, handleAdminGetTools);
app.patch("/api/admin/tools/:toolName", adminOnly, handleAdminUpdateTool);

// ── Admin — approvals ──────────────────────────────────────────────────────
app.get("/api/admin/approvals", adminOnly, handleAdminGetApprovals);
app.post("/api/admin/approvals/:id/approve", adminOnly, handleAdminApproveRequest);
app.post("/api/admin/approvals/:id/reject", adminOnly, handleAdminRejectRequest);

// ── Admin — LLM routing config ─────────────────────────────────────────────
app.get("/api/admin/llm-config", adminOnly, handleAdminGetLlmConfig);
app.put("/api/admin/llm-config", adminOnly, handleAdminPutLlmConfig);
app.get("/api/admin/llm-config/models", adminOnly, handleAdminGetLlmModels);

// ── LLM request log ────────────────────────────────────────────────────────
app.get("/api/admin/llm-logs", async (req, res) => {
  const userRole = req.headers["x-user-role"] as string | undefined;
  if (userRole !== "admin") { res.status(403).json({ error: "admin only" }); return; }
  const limit = Math.min(Number(req.query["limit"] ?? 20), 100);
  const id = req.query["id"] as string | undefined;
  try {
    if (id) {
      const result = await pool.query(
        `SELECT l.*, u.username FROM llm_request_logs l LEFT JOIN users u ON u.id=l.user_id WHERE l.id=$1`,
        [id]
      );
      res.json(result.rows[0] ?? null);
    } else {
      const result = await pool.query(
        `SELECT l.id, l.session_id, l.user_id, u.username, l.tool_names, l.tools_called,
                l.orchestrator_model, l.synthesizer_model, l.created_at,
                l.data_mode, l.orchestrator_provider, l.synth_provider,
                l.orch_prompt_tokens, l.orch_completion_tokens, l.orch_total_tokens, l.orch_iterations,
                l.synth_prompt_tokens, l.synth_completion_tokens, l.synth_total_tokens,
                l.total_tokens, l.tool_result_chars, l.prequery_hit, l.prequery_tool,
                LEFT(l.system_prompt, 200) AS system_prompt_preview,
                jsonb_array_length(l.messages) AS message_count
         FROM llm_request_logs l LEFT JOIN users u ON u.id=l.user_id
         ORDER BY l.created_at DESC LIMIT $1`,
        [limit]
      );
      res.json(result.rows);
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Admin — data sync ──────────────────────────────────────────────────────
app.get("/api/admin/sync/status", async (req, res) => {
  const userRole = req.headers["x-user-role"] as string | undefined;
  if (userRole !== "admin") { res.status(403).json({ error: "admin only" }); return; }
  try {
    const status = await getSyncStatus(pool);
    res.json({ ...status, paused: isSyncPaused() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/admin/sync", async (req, res) => {
  const userRole = req.headers["x-user-role"] as string | undefined;
  if (userRole !== "admin") { res.status(403).json({ error: "admin only" }); return; }
  if (isSyncPaused()) { res.status(409).json({ error: "sync_paused", message: "Sync is paused. Resume sync before triggering manually." }); return; }
  const { type } = req.body as { type?: string };
  res.json({ started: true, type: type ?? "full" });
  // Run in background after response is sent
  setImmediate(() => {
    if (type === "alerts") {
      runAlertSync(pool, "manual").catch(() => {});
    } else {
      runSync(pool, "manual").catch(() => {});
    }
  });
});

// SEC-016: Sync health endpoint — surfaces staleness so admins know when data is stale
app.get("/api/admin/sync/health", async (req, res) => {
  const userRole = req.headers["x-user-role"] as string | undefined;
  if (userRole !== "admin") { res.status(403).json({ error: "admin only" }); return; }
  try {
    const result = await pool.query<{ completed_at: Date; status: string }>(
      `SELECT completed_at, status FROM datto_sync_log
       WHERE status = 'completed' AND triggered_by IN ('schedule','manual')
       ORDER BY started_at DESC LIMIT 1`
    );
    const last = result.rows[0];
    if (!last) {
      res.json({ status: "never_run", lastSuccess: null, ageMinutes: null });
      return;
    }
    const ageMs = Date.now() - new Date(last.completed_at).getTime();
    const ageMinutes = Math.round(ageMs / 60_000);
    const status = ageMinutes > 26 * 60 ? "stale" : "ok";
    res.json({ status, lastSuccess: last.completed_at, ageMinutes });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/admin/sync/pause", (req, res) => {
  const userRole = req.headers["x-user-role"] as string | undefined;
  if (userRole !== "admin") { res.status(403).json({ error: "admin only" }); return; }
  pauseSync();
  res.json({ paused: true });
});

app.post("/api/admin/sync/resume", (req, res) => {
  const userRole = req.headers["x-user-role"] as string | undefined;
  if (userRole !== "admin") { res.status(403).json({ error: "admin only" }); return; }
  resumeSync();
  res.json({ paused: false });
});

// ── Admin — data browser ───────────────────────────────────────────────────
function adminOnly(req: express.Request, res: express.Response, next: express.NextFunction) {
  if ((req.headers["x-user-role"] as string) !== "admin") {
    res.status(403).json({ error: "admin only" }); return;
  }
  next();
}

app.get("/api/admin/browser/overview",         adminOnly, (req, res) => handleBrowserOverview(req, res, pool));
app.get("/api/admin/browser/sites",            adminOnly, (req, res) => handleBrowserSites(req, res, pool));
app.get("/api/admin/browser/sites/:uid",       adminOnly, (req, res) => handleBrowserSite(req, res, pool));
app.get("/api/admin/browser/devices",          adminOnly, (req, res) => handleBrowserDevices(req, res, pool));
app.get("/api/admin/browser/devices/:uid",     adminOnly, (req, res) => handleBrowserDevice(req, res, pool));
app.get("/api/admin/browser/devices/:uid/software", adminOnly, (req, res) => handleBrowserDeviceSoftware(req, res, pool));
app.get("/api/admin/browser/alerts",           adminOnly, (req, res) => handleBrowserAlerts(req, res, pool));

// ── Admin — vulnerability browser ─────────────────────────────────────────
app.get("/api/admin/browser/vulnerabilities/summary",      adminOnly, (req, res) => handleVulnSummary(req, res, pool));
app.get("/api/admin/browser/vulnerabilities/software",     adminOnly, (req, res) => handleVulnSoftwareList(req, res, pool));
app.get("/api/admin/browser/vulnerabilities",              adminOnly, (req, res) => handleVulnList(req, res, pool));
app.get("/api/admin/browser/devices/:uid/vulnerabilities", adminOnly, (req, res) => handleDeviceVulns(req, res, pool));
app.post("/api/admin/cve-scan",                            adminOnly, (req, res) => handleCveScanTrigger(req, res, pool));
app.get("/api/admin/cve-scan/status",                      adminOnly, (req, res) => handleCveScanStatus(req, res, pool));

// ── Admin — observability ──────────────────────────────────────────────────
app.get("/api/admin/observability/overview", adminOnly, (req, res) => handleObsOverview(req, res, pool));
app.get("/api/admin/observability/llm",      adminOnly, (req, res) => handleObsLlm(req, res, pool));
app.get("/api/admin/observability/tools",    adminOnly, (req, res) => handleObsTools(req, res, pool));
app.get("/api/admin/observability/mcp",      adminOnly, (req, res) => handleObsMcp(req, res, pool));
app.get("/api/admin/observability/chat",     adminOnly, (req, res) => handleObsChat(req, res, pool));
app.get("/api/admin/observability/cache",    adminOnly, (req, res) => handleObsCache(req, res, pool));

// ── Admin — request traces ─────────────────────────────────────────────────
app.get("/api/admin/observability/traces",          adminOnly, (req, res) => handleListTraces(req, res, pool));
app.get("/api/admin/observability/traces/:traceId", adminOnly, (req, res) => handleGetTrace(req, res, pool));

// ── Internal — span ingestion from mcp-bridge ──────────────────────────────
app.post("/api/internal/trace-spans", (req, res) => handleIngestSpans(req, res, pool));

// ── Platform SSE route ─────────────────────────────────────────────────────
app.post("/chat", chatRateLimit, handleChat);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const port = Number(process.env["PORT"] ?? 6001);
app.listen(port, () => {
  log("info", `ai-service listening on :${port}`);
  startScheduledSync(pool);

  // 30-day trace cleanup — runs every hour
  setInterval(async () => {
    try {
      const result = await pool.query(
        `DELETE FROM request_traces WHERE created_at < NOW() - INTERVAL '30 days'`
      );
      if (result.rowCount && result.rowCount > 0) {
        log("info", "trace_cleanup", { deleted: result.rowCount });
      }
    } catch (err) {
      log("error", "trace_cleanup_error", { error: String(err) });
    }
  }, 3_600_000);
});
