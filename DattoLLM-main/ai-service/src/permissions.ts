/**
 * SEC-Cache-001: Tool permission check utilities.
 *
 * Provides a hard permission gate inside ai-service that validates every tool
 * call name against `allowedTools` BEFORE execution. This covers both cached
 * and live paths — cached tools previously had no permission check at all.
 */

import type { Pool } from "pg";

function log(level: "info" | "warn", msg: string, extra?: Record<string, unknown>) {
  const line = JSON.stringify({ level, msg, ts: Date.now(), ...extra });
  process.stdout.write(line + "\n");
}

/** Pure sync check — is this tool in the user's allowed set? */
export function isToolAllowed(toolName: string, allowedTools: string[]): boolean {
  return allowedTools.includes(toolName);
}

/** Denial message — SEC: normalized to prevent tool name enumeration via prompt injection */
export function toolDeniedMessage(_toolName: string): string {
  return "The requested operation is not permitted for your account. Contact your administrator to adjust your role permissions.";
}

/**
 * SEC-Cache-001: Check tool permission + audit-log denial.
 * Returns true if permitted, false if denied (and logs to audit_logs).
 * The `context` parameter distinguishes cached from live_preflight denials.
 */
export async function checkAndAuditToolPermission(
  toolName: string,
  allowedTools: string[],
  userId: string,
  requestId: string,
  db: Pool,
  context: "cached" | "live_preflight"
): Promise<boolean> {
  if (allowedTools.includes(toolName)) return true;

  // Denied — log and audit
  log("warn", "tool_denied", { toolName, requestId, sec: "SEC-Cache-001", context });
  db.query(
    "INSERT INTO audit_logs (user_id, event_type, tool_name, metadata) VALUES ($1, $2, $3, $4)",
    [userId, "tool_denied", toolName, JSON.stringify({ sec: "SEC-Cache-001", context, requestId })]
  ).catch(() => {});

  return false;
}
