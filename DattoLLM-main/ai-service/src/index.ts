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
import { pool } from "./db.js";
import { runSync, runAlertSync, getSyncStatus, startScheduledSync, pauseSync, resumeSync, isSyncPaused } from "./sync.js";
import {
  handleBrowserOverview, handleBrowserSites, handleBrowserSite,
  handleBrowserDevices, handleBrowserDevice, handleBrowserDeviceSoftware,
  handleBrowserAlerts,
} from "./dataBrowser.js";

function log(level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>) {
  const line = JSON.stringify({ level, msg, ts: Date.now(), ...extra });
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

function validateEnv() {
  for (const key of ["DATABASE_URL", "ANTHROPIC_API_KEY", "MCP_BRIDGE_URL", "EMBEDDING_SERVICE_URL"]) {
    if (!process.env[key]) {
      log("error", `Missing required environment variable: ${key}`);
      process.exit(1);
    }
  }
}

validateEnv();

const app = express();
app.use(cors());
app.use(express.json());

// ── Legacy chat & history ──────────────────────────────────────────────────
app.post("/api/chat", handleLegacyChat);
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
      `SELECT s.id, s.created_at AS timestamp, s.user_id, s.allowed_tools,
              m_user.content AS question,
              m_asst.content AS answer,
              m_asst.tools_used
       FROM chat_sessions s
       JOIN LATERAL (SELECT content FROM chat_messages WHERE session_id = s.id AND role = 'user'      ORDER BY created_at ASC  LIMIT 1) m_user ON true
       JOIN LATERAL (SELECT content, tools_used FROM chat_messages WHERE session_id = s.id AND role = 'assistant' ORDER BY created_at DESC LIMIT 1) m_asst ON true
       WHERE s.user_id = $1
       ORDER BY s.created_at DESC
       LIMIT 20`,
      [userId]
    );
    const traces = result.rows.map((r: Record<string, unknown>) => ({
      id: r["id"],
      timestamp: r["timestamp"],
      userId: r["user_id"],
      role: "user",
      question: r["question"],
      allowedTools: (r["allowed_tools"] as string[]) ?? [],
      toolCalls: ((r["tools_used"] as string[]) ?? []).map((name: string) => ({
        name,
        args: {},
        resultPreview: "",
        durationMs: 0,
      })),
      answer: r["answer"],
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

// ── Admin — users ──────────────────────────────────────────────────────────
app.get("/api/admin/users", handleAdminGetUsers);
app.post("/api/admin/users", handleAdminCreateUser);
app.patch("/api/admin/users/:id", handleAdminUpdateUser);
app.patch("/api/admin/users/:id/password", handleAdminChangePassword);
app.get("/api/admin/users/:id/tools", handleAdminGetUserTools);
app.put("/api/admin/users/:id/tools", handleAdminSetUserTools);

// ── Admin — roles ──────────────────────────────────────────────────────────
app.get("/api/admin/roles", handleAdminGetRoles);
app.put("/api/admin/roles/:role", handleAdminSaveRole);
app.delete("/api/admin/roles/:role", handleAdminDeleteRole);

// ── Admin — tools ──────────────────────────────────────────────────────────
app.get("/api/admin/tools", handleAdminGetTools);
app.patch("/api/admin/tools/:toolName", handleAdminUpdateTool);

// ── Admin — approvals ──────────────────────────────────────────────────────
app.get("/api/admin/approvals", handleAdminGetApprovals);
app.post("/api/admin/approvals/:id/approve", handleAdminApproveRequest);
app.post("/api/admin/approvals/:id/reject", handleAdminRejectRequest);

// ── Admin — LLM routing config ─────────────────────────────────────────────
app.get("/api/admin/llm-config", handleAdminGetLlmConfig);
app.put("/api/admin/llm-config", handleAdminPutLlmConfig);
app.get("/api/admin/llm-config/models", handleAdminGetLlmModels);

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

// ── Platform SSE route ─────────────────────────────────────────────────────
app.post("/chat", handleChat);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const port = Number(process.env["PORT"] ?? 6001);
app.listen(port, () => {
  log("info", `ai-service listening on :${port}`);
  startScheduledSync(pool);
});
