import type { Request, Response } from "express";
import { pool } from "./db.js";

export async function handleGetMyApprovals(req: Request, res: Response): Promise<void> {
  const userId = req.headers["x-user-id"] as string | undefined;
  if (!userId) { res.status(401).json({ error: "missing x-user-id" }); return; }
  try {
    const result = await pool.query(
      `SELECT a.id, a.tool_name, a.parameters, a.status, a.risk_level, a.created_at, a.approved_at,
              apr.username AS approved_by_name
       FROM approvals a
       LEFT JOIN users apr ON apr.id = a.approved_by
       WHERE a.requester_id = $1
       ORDER BY a.created_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: "Failed to load approvals" });
  }
}

export async function handleGetApprovable(req: Request, res: Response): Promise<void> {
  const userId = req.headers["x-user-id"] as string | undefined;
  if (!userId) { res.status(401).json({ error: "missing x-user-id" }); return; }
  try {
    // Requests the user can approve = pending approvals where any tool in user's approval_authority
    const authResult = await pool.query(
      "SELECT approval_authority FROM users WHERE id = $1",
      [userId]
    );
    const authority: string[] = (authResult.rows[0] as { approval_authority: string[] } | undefined)?.approval_authority ?? [];
    if (authority.length === 0) { res.json([]); return; }

    const result = await pool.query(
      `SELECT a.id, a.tool_name, a.parameters, a.status, a.risk_level, a.created_at, a.approved_at,
              req.username AS requested_by,
              apr.username AS approved_by_name
       FROM approvals a
       LEFT JOIN users req ON req.id = a.requester_id
       LEFT JOIN users apr ON apr.id = a.approved_by
       WHERE a.status = 'pending' AND a.tool_name = ANY($1)
       ORDER BY a.created_at DESC`,
      [authority]
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: "Failed to load approvable requests" });
  }
}

export async function handleUserApprove(req: Request, res: Response): Promise<void> {
  const id = req.params["id"];
  const userId = req.headers["x-user-id"] as string | undefined;
  if (!userId) { res.status(401).json({ error: "missing x-user-id" }); return; }
  try {
    await pool.query(
      "UPDATE approvals SET status = 'approved', approved_by = $1, approved_at = NOW() WHERE id = $2 AND status = 'pending'",
      [userId, id]
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to approve" });
  }
}

export async function handleUserReject(req: Request, res: Response): Promise<void> {
  const id = req.params["id"];
  const userId = req.headers["x-user-id"] as string | undefined;
  if (!userId) { res.status(401).json({ error: "missing x-user-id" }); return; }
  try {
    await pool.query(
      "UPDATE approvals SET status = 'rejected', approved_by = $1, approved_at = NOW() WHERE id = $2 AND status = 'pending'",
      [userId, id]
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to reject" });
  }
}
