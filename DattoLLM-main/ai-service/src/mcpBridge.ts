import { pool } from "./db.js";

function log(level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>) {
  const line = JSON.stringify({ level, msg, ts: Date.now(), ...extra });
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export async function callTool(
  toolName: string,
  toolArgs: Record<string, unknown>,
  allowedTools: string[],
  requestId: string,
  userId?: string
): Promise<{ success: boolean; isError?: boolean; result: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);

  try {
    const res = await fetch(process.env["MCP_BRIDGE_URL"]! + "/tool-call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolName, toolArgs, requestId, allowedTools }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

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

    return (await res.json()) as { success: boolean; isError?: boolean; result: unknown };
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
