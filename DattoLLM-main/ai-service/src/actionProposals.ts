/**
 * ActionProposal API — write tool staging and confirmation flow.
 *
 * SEC-Write-001: The LLM never executes write operations directly.
 * Flow: Stage → User confirms → Execute (with immutable audit log entry)
 *
 * State machine: pending → confirmed/rejected → executed
 * Proposals expire after 15 minutes if not confirmed (see 015_action_proposals.sql).
 *
 * Parameter masking (SEC-Write-004):
 *   Sensitive fields in tool args are replaced with "***" before persistence.
 *   The caller supplies pre-masked args — this module does not inspect arg content.
 */

import type { Request, Response } from "express";
import type { Pool } from "pg";

function log(level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>) {
  const line = JSON.stringify({ level, msg, ts: Date.now(), ...extra });
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

// ---------------------------------------------------------------------------
// Stage a new ActionProposal
// POST /api/proposals
// Body: { toolName, toolArgsMasked, sessionId, requestId }
// Called by the chat pipeline when the LLM selects a write tool.
// ---------------------------------------------------------------------------
export async function handleStageProposal(req: Request, res: Response, pool: Pool): Promise<void> {
  const userId = req.headers["x-user-id"] as string | undefined;
  if (!userId) { res.status(401).json({ error: "missing x-user-id" }); return; }

  const { toolName, toolArgsMasked, sessionId, requestId } = req.body as {
    toolName?: string;
    toolArgsMasked?: Record<string, unknown>;
    sessionId?: string;
    requestId?: string;
  };

  if (!toolName || !requestId) {
    res.status(400).json({ error: "toolName and requestId are required" });
    return;
  }

  try {
    const result = await pool.query<{ id: string; expires_at: Date }>(
      `INSERT INTO action_proposals
         (user_id, session_id, tool_name, tool_args_masked, request_id, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, expires_at`,
      [userId, sessionId ?? null, toolName, JSON.stringify(toolArgsMasked ?? {}), requestId, req.ip ?? null]
    );
    const row = result.rows[0]!;
    log("info", "proposal_staged", { proposalId: row.id, userId, toolName });
    res.status(201).json({ id: row.id, status: "pending", expiresAt: row.expires_at });
  } catch (err) {
    log("error", "stage_proposal_error", { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: "Failed to stage proposal" });
  }
}

// ---------------------------------------------------------------------------
// List pending proposals for the calling user
// GET /api/proposals
// ---------------------------------------------------------------------------
export async function handleListProposals(req: Request, res: Response, pool: Pool): Promise<void> {
  const userId = req.headers["x-user-id"] as string | undefined;
  if (!userId) { res.status(401).json({ error: "missing x-user-id" }); return; }

  try {
    const result = await pool.query(
      `SELECT id, tool_name, tool_args_masked, proposed_at, expires_at, status
       FROM action_proposals
       WHERE user_id = $1
         AND status = 'pending'
         AND expires_at > now()
       ORDER BY proposed_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// User confirms a proposal
// POST /api/proposals/:id/confirm
// ---------------------------------------------------------------------------
export async function handleConfirmProposal(req: Request, res: Response, pool: Pool): Promise<void> {
  const userId = req.headers["x-user-id"] as string | undefined;
  if (!userId) { res.status(401).json({ error: "missing x-user-id" }); return; }

  const { id } = req.params as { id: string };

  try {
    const result = await pool.query<{ id: string; tool_name: string; status: string; expires_at: Date }>(
      `UPDATE action_proposals
       SET status = 'confirmed', confirmed_at = now()
       WHERE id = $1
         AND user_id = $2
         AND status = 'pending'
         AND expires_at > now()
       RETURNING id, tool_name, status, expires_at`,
      [id, userId]
    );

    if (!result.rows[0]) {
      res.status(404).json({ error: "Proposal not found, already actioned, or expired" });
      return;
    }

    const row = result.rows[0];
    log("info", "proposal_confirmed", { proposalId: id, userId, toolName: row.tool_name });

    await pool.query(
      "INSERT INTO audit_logs (user_id, event_type, tool_name, ip_address) VALUES ($1, $2, $3, $4)",
      [userId, "proposal_confirmed", row.tool_name, req.ip ?? null]
    ).catch(() => {});

    res.json({ id: row.id, status: row.status });
  } catch (err) {
    log("error", "confirm_proposal_error", { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: "Failed to confirm proposal" });
  }
}

// ---------------------------------------------------------------------------
// User rejects a proposal
// POST /api/proposals/:id/reject
// ---------------------------------------------------------------------------
export async function handleRejectProposal(req: Request, res: Response, pool: Pool): Promise<void> {
  const userId = req.headers["x-user-id"] as string | undefined;
  if (!userId) { res.status(401).json({ error: "missing x-user-id" }); return; }

  const { id } = req.params as { id: string };

  try {
    const result = await pool.query<{ id: string; tool_name: string }>(
      `UPDATE action_proposals
       SET status = 'rejected'
       WHERE id = $1
         AND user_id = $2
         AND status IN ('pending', 'confirmed')
       RETURNING id, tool_name`,
      [id, userId]
    );

    if (!result.rows[0]) {
      res.status(404).json({ error: "Proposal not found or already executed" });
      return;
    }

    const row = result.rows[0];
    log("info", "proposal_rejected", { proposalId: id, userId, toolName: row.tool_name });

    await pool.query(
      "INSERT INTO audit_logs (user_id, event_type, tool_name, ip_address) VALUES ($1, $2, $3, $4)",
      [userId, "proposal_rejected", row.tool_name, req.ip ?? null]
    ).catch(() => {});

    res.json({ id: row.id, status: "rejected" });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Execute a confirmed proposal (internal — called by chat pipeline, not directly by users)
// POST /api/proposals/:id/execute
// Requires x-user-role: admin OR x-internal-execute header (set only by ai-service)
// ---------------------------------------------------------------------------
export async function handleExecuteProposal(req: Request, res: Response, pool: Pool): Promise<void> {
  const userId = req.headers["x-user-id"] as string | undefined;
  const userRole = req.headers["x-user-role"] as string | undefined;
  const internalHeader = req.headers["x-internal-execute"] as string | undefined;

  // Only admin users or internal ai-service calls may execute proposals
  if (userRole !== "admin" && internalHeader !== process.env["MCP_INTERNAL_SECRET"]) {
    res.status(403).json({ error: "Not authorized to execute proposals" });
    return;
  }

  const { id } = req.params as { id: string };
  const { executionResult } = req.body as { executionResult?: unknown };

  try {
    const result = await pool.query<{ id: string; tool_name: string; user_id: string }>(
      `UPDATE action_proposals
       SET status = 'executed', executed_at = now(), execution_result = $1
       WHERE id = $2
         AND status = 'confirmed'
       RETURNING id, tool_name, user_id`,
      [JSON.stringify(executionResult ?? null), id]
    );

    if (!result.rows[0]) {
      res.status(404).json({ error: "Proposal not found or not in confirmed state" });
      return;
    }

    const row = result.rows[0];
    log("info", "proposal_executed", { proposalId: id, toolName: row.tool_name, executedBy: userId });

    // Immutable audit log entry for write tool execution
    await pool.query(
      `INSERT INTO audit_logs (user_id, event_type, tool_name, ip_address, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        row.user_id,
        "write_tool_executed",
        row.tool_name,
        req.ip ?? null,
        JSON.stringify({ proposalId: id, executedBy: userId }),
      ]
    ).catch(() => {});

    res.json({ id: row.id, status: "executed" });
  } catch (err) {
    log("error", "execute_proposal_error", { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: "Failed to execute proposal" });
  }
}
