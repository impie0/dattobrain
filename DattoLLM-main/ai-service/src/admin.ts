import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { pool } from "./db.js";
import { toolRegistry } from "./toolRegistry.js";
import { invalidateRoutingConfigCache } from "./llmConfig.js";

// ── Users ──────────────────────────────────────────────────────────────────

export async function handleAdminGetUsers(_req: Request, res: Response): Promise<void> {
  try {
    const result = await pool.query(`
      SELECT u.id, u.username, u.email, u.is_active, u.approval_authority, u.created_at,
             COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);
    const users = result.rows.map((u: Record<string, unknown>) => ({
      ...u,
      role: (u["roles"] as string[])[0] ?? "readonly",
    }));
    res.json(users);
  } catch {
    res.status(500).json({ error: "Failed to list users" });
  }
}

export async function handleAdminCreateUser(req: Request, res: Response): Promise<void> {
  const { username, email, password, role } = req.body as {
    username?: string; email?: string; password?: string; role?: string;
  };
  if (!username || !email || !password) {
    res.status(400).json({ error: "username, email, and password are required" });
    return;
  }
  const client = await pool.connect();
  try {
    const hash = await bcrypt.hash(password, 12);
    const userResult = await client.query(
      "INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id",
      [username, email, hash]
    );
    const userId = (userResult.rows[0] as { id: string }).id;
    if (role) {
      const roleResult = await client.query("SELECT id FROM roles WHERE name = $1", [role]);
      if (roleResult.rows[0]) {
        await client.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)", [userId, (roleResult.rows[0] as { id: string }).id]);
      }
    }
    res.json({ id: userId });
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg.code === "23505") res.status(409).json({ error: "Username or email already exists" });
    else res.status(500).json({ error: "Failed to create user" });
  } finally {
    client.release();
  }
}

export async function handleAdminUpdateUser(req: Request, res: Response): Promise<void> {
  const id = req.params["id"];
  const { role, is_active, approval_authority } = req.body as {
    role?: string; is_active?: boolean; approval_authority?: string[];
  };
  const client = await pool.connect();
  try {
    if (is_active !== undefined) {
      await client.query("UPDATE users SET is_active = $1 WHERE id = $2", [is_active, id]);
    }
    if (approval_authority !== undefined) {
      await client.query("UPDATE users SET approval_authority = $1 WHERE id = $2", [approval_authority, id]);
    }
    if (role !== undefined) {
      await client.query("DELETE FROM user_roles WHERE user_id = $1", [id]);
      const roleResult = await client.query("SELECT id FROM roles WHERE name = $1", [role]);
      if (roleResult.rows[0]) {
        await client.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)", [id, (roleResult.rows[0] as { id: string }).id]);
      }
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to update user" });
  } finally {
    client.release();
  }
}

export async function handleAdminChangePassword(req: Request, res: Response): Promise<void> {
  const id = req.params["id"];
  const { password } = req.body as { password?: string };
  if (!password) { res.status(400).json({ error: "password required" }); return; }
  try {
    const hash = await bcrypt.hash(password, 12);
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, id]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to change password" });
  }
}

export async function handleAdminGetUserTools(req: Request, res: Response): Promise<void> {
  const id = req.params["id"];
  try {
    const overrides = await pool.query("SELECT tool_name FROM user_tool_overrides WHERE user_id = $1", [id]);
    if (overrides.rows.length > 0) {
      res.json(overrides.rows.map((r: { tool_name: string }) => r.tool_name));
      return;
    }
    const result = await pool.query(
      `SELECT DISTINCT tp.tool_name FROM tool_permissions tp
       JOIN user_roles ur ON ur.role_id = tp.role_id WHERE ur.user_id = $1`,
      [id]
    );
    res.json(result.rows.map((r: { tool_name: string }) => r.tool_name));
  } catch {
    res.status(500).json({ error: "Failed to get user tools" });
  }
}

export async function handleAdminSetUserTools(req: Request, res: Response): Promise<void> {
  const id = req.params["id"];
  const { tools } = req.body as { tools?: string[] };
  if (!Array.isArray(tools)) { res.status(400).json({ error: "tools array required" }); return; }
  const client = await pool.connect();
  try {
    await client.query("DELETE FROM user_tool_overrides WHERE user_id = $1", [id]);
    for (const tool of tools) {
      await client.query(
        "INSERT INTO user_tool_overrides (user_id, tool_name) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [id, tool]
      );
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to set user tools" });
  } finally {
    client.release();
  }
}

// ── Roles ──────────────────────────────────────────────────────────────────

export async function handleAdminGetRoles(_req: Request, res: Response): Promise<void> {
  try {
    const result = await pool.query(`
      SELECT r.name AS role,
             COALESCE(array_agg(tp.tool_name) FILTER (WHERE tp.tool_name IS NOT NULL), '{}') AS tools
      FROM roles r
      LEFT JOIN tool_permissions tp ON tp.role_id = r.id
      GROUP BY r.name
      ORDER BY r.name
    `);
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: "Failed to list roles" });
  }
}

export async function handleAdminSaveRole(req: Request, res: Response): Promise<void> {
  const roleName = req.params["role"];
  const { tools } = req.body as { tools?: string[] };
  if (!Array.isArray(tools)) { res.status(400).json({ error: "tools array required" }); return; }
  const client = await pool.connect();
  try {
    await client.query("INSERT INTO roles (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [roleName]);
    const roleResult = await client.query("SELECT id FROM roles WHERE name = $1", [roleName]);
    const roleId = (roleResult.rows[0] as { id: string }).id;
    await client.query("DELETE FROM tool_permissions WHERE role_id = $1", [roleId]);
    for (const tool of tools) {
      await client.query(
        "INSERT INTO tool_permissions (role_id, tool_name) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [roleId, tool]
      );
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to save role" });
  } finally {
    client.release();
  }
}

export async function handleAdminDeleteRole(req: Request, res: Response): Promise<void> {
  const roleName = req.params["role"];
  try {
    await pool.query("DELETE FROM roles WHERE name = $1", [roleName]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete role" });
  }
}

// ── Tools ──────────────────────────────────────────────────────────────────

export async function handleAdminGetTools(_req: Request, res: Response): Promise<void> {
  try {
    const policiesResult = await pool.query(
      "SELECT tool_name, risk_level, approval_required, description FROM tool_policies"
    );
    const policies = new Map(
      policiesResult.rows.map((r: { tool_name: string; risk_level: string; approval_required: boolean; description: string | null }) => [r.tool_name, r])
    );
    const tools = toolRegistry.map((t) => {
      const p = policies.get(t.name) as { risk_level: string; approval_required: boolean; description: string | null } | undefined;
      return {
        tool_name: t.name,
        permission: "allowed",
        approval_required: p?.approval_required ?? false,
        risk_level: p?.risk_level ?? "low",
        description: p?.description ?? t.description,
      };
    });
    res.json(tools);
  } catch {
    res.status(500).json({ error: "Failed to list tools" });
  }
}

export async function handleAdminUpdateTool(req: Request, res: Response): Promise<void> {
  const toolName = req.params["toolName"];
  const { approval_required, risk_level } = req.body as {
    approval_required?: boolean; risk_level?: string;
  };
  try {
    await pool.query(
      `INSERT INTO tool_policies (tool_name, approval_required, risk_level)
       VALUES ($1, COALESCE($2, false), COALESCE($3, 'low'))
       ON CONFLICT (tool_name) DO UPDATE SET
         approval_required = CASE WHEN $2 IS NOT NULL THEN $2 ELSE tool_policies.approval_required END,
         risk_level = CASE WHEN $3 IS NOT NULL THEN $3 ELSE tool_policies.risk_level END`,
      [toolName, approval_required ?? null, risk_level ?? null]
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to update tool policy" });
  }
}

// ── Admin Approvals ────────────────────────────────────────────────────────

export async function handleAdminGetApprovals(req: Request, res: Response): Promise<void> {
  const status = req.query["status"] as string | undefined;
  try {
    const params: string[] = [];
    const where = status ? (params.push(status), "WHERE a.status = $1") : "";
    const result = await pool.query(
      `SELECT a.id, a.tool_name, a.parameters, a.status, a.risk_level, a.created_at, a.approved_at,
              req.username AS requested_by,
              apr.username AS approved_by_name
       FROM approvals a
       LEFT JOIN users req ON req.id = a.requester_id
       LEFT JOIN users apr ON apr.id = a.approved_by
       ${where}
       ORDER BY a.created_at DESC`,
      params
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: "Failed to list approvals" });
  }
}

export async function handleAdminApproveRequest(req: Request, res: Response): Promise<void> {
  const id = req.params["id"];
  const userId = req.headers["x-user-id"] as string | undefined;
  try {
    await pool.query(
      "UPDATE approvals SET status = 'approved', approved_by = $1, approved_at = NOW() WHERE id = $2",
      [userId ?? null, id]
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to approve request" });
  }
}

export async function handleAdminRejectRequest(req: Request, res: Response): Promise<void> {
  const id = req.params["id"];
  const userId = req.headers["x-user-id"] as string | undefined;
  try {
    await pool.query(
      "UPDATE approvals SET status = 'rejected', approved_by = $1, approved_at = NOW() WHERE id = $2",
      [userId ?? null, id]
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to reject request" });
  }
}

// ── LLM Routing Config ────────────────────────────────────────────────────────

const LLM_MODELS = [
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5",    provider: "anthropic", canOrchestrate: true  },
  { id: "claude-sonnet-4-5",         label: "Claude Sonnet 4.5",   provider: "anthropic", canOrchestrate: true  },
  { id: "claude-opus-4-6",           label: "Claude Opus 4.6",     provider: "anthropic", canOrchestrate: true  },
  { id: "local/qwen3-1.7b",           label: "Qwen3 1.7B (Local)",   provider: "ollama",    canOrchestrate: false },
  { id: "deepseek/deepseek-r1",      label: "DeepSeek R1",         provider: "deepseek",  canOrchestrate: false },
  { id: "deepseek/deepseek-chat",    label: "DeepSeek Chat",       provider: "deepseek",  canOrchestrate: false },
  { id: "gemini/gemini-2.0-flash",   label: "Gemini 2.0 Flash",    provider: "google",    canOrchestrate: false },
];

export async function handleAdminGetLlmConfig(_req: Request, res: Response): Promise<void> {
  try {
    const result = await pool.query("SELECT key, model, description FROM llm_routing_config ORDER BY key");
    res.json({ items: result.rows });
  } catch {
    res.status(500).json({ error: "Failed to load LLM config" });
  }
}

export async function handleAdminPutLlmConfig(req: Request, res: Response): Promise<void> {
  const { updates } = req.body as { updates?: { key: string; model: string }[] };
  if (!Array.isArray(updates) || updates.length === 0) {
    res.status(400).json({ error: "updates array required" });
    return;
  }
  try {
    for (const { key, model } of updates) {
      await pool.query(
        `UPDATE llm_routing_config SET model = $1 WHERE key = $2`,
        [model, key]
      );
    }
    invalidateRoutingConfigCache();
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to update LLM config" });
  }
}

export async function handleAdminGetLlmModels(_req: Request, res: Response): Promise<void> {
  res.json({ models: LLM_MODELS });
}
