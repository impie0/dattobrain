import { pool } from "./db.js";
import type { ExternalSpan } from "./tracing.js";
import { TraceContext } from "./tracing.js";

function log(level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>) {
  const line = JSON.stringify({ level, msg, ts: Date.now(), ...extra });
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

/**
 * Call a tool via the MCP bridge.
 *
 * Passes the user's JWT token so the bridge can independently verify
 * permissions against auth-service (SEC-MCP-001 — bridge does not trust
 * caller-supplied allowedTools; it re-derives them from the token).
 *
 * The legacy `allowedTools` parameter is still sent for internal-service
 * callers (sync scheduler) that use X-Internal-Secret bypass, but is
 * ignored by the bridge for user requests.
 *
 * traceId / parentSpanId enable distributed tracing — the bridge collects
 * its own spans and returns them in `_traceSpans` on the response JSON.
 */
export async function callTool(
  toolName: string,
  toolArgs: Record<string, unknown>,
  allowedTools: string[],
  requestId: string,
  userId?: string,
  jwtToken?: string,
  traceId?: string,
  parentSpanId?: string,
): Promise<{ success: boolean; isError?: boolean; result: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (traceId) headers["X-Trace-Id"] = traceId;
  if (parentSpanId) headers["X-Parent-Span-Id"] = parentSpanId;

  try {
    const res = await fetch(process.env["MCP_BRIDGE_URL"]! + "/tool-call", {
      method: "POST",
      headers,
      body: JSON.stringify({ toolName, toolArgs, requestId, allowedTools, jwtToken }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (res.status === 401) {
      log("warn", "tool_call_unauthorized", { toolName, requestId });
      pool.query(
        "INSERT INTO audit_logs (user_id, event_type, tool_name) VALUES ($1, $2, $3)",
        [userId ?? null, "tool_unauthorized", toolName]
      ).catch(() => {});
      return {
        success: false,
        isError: true,
        result: { content: [{ type: "text", text: `Tool '${toolName}' permission check failed.` }] },
      };
    }

    if (res.status === 403) {
      log("warn", "tool_denied", { toolName, requestId });
      pool.query(
        "INSERT INTO audit_logs (user_id, event_type, tool_name) VALUES ($1, $2, $3)",
        [userId ?? null, "tool_denied", toolName]
      ).catch(() => {});
      return {
        success: false,
        isError: true,
        result: { content: [{ type: "text", text: `Tool '${toolName}' is not permitted for your account.` }] },
      };
    }

    if (!res.ok) {
      log("warn", "mcp_bridge_non_200", { status: res.status, toolName, requestId });
      return {
        success: false,
        isError: true,
        result: { content: [{ type: "text", text: "Tool call failed" }] },
      };
    }

    const body = (await res.json()) as {
      success: boolean;
      isError?: boolean;
      result: unknown;
      _traceSpans?: ExternalSpan[];
    };

    // Ingest trace spans from the bridge (and any MCP server spans it collected)
    if (traceId && body._traceSpans && body._traceSpans.length > 0) {
      const ctx = new TraceContext(pool, traceId);
      ctx.ingestExternalSpans(body._traceSpans).catch(() => {});
    }

    return { success: body.success, isError: body.isError, result: body.result };
  } catch (err) {
    clearTimeout(timeout);
    log("error", "mcp_bridge_error", {
      toolName,
      requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      isError: true,
      result: { content: [{ type: "text", text: "Tool call failed" }] },
    };
  }
}
