import express from "express";
import cors from "cors";
import { checkPermission } from "./validate.js";
import { callMcpTool } from "./mcpClient.js";

function log(level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>) {
  const line = JSON.stringify({ level, msg, ts: Date.now(), ...extra });
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

function validateEnv() {
  for (const key of ["MCP_SERVER_URL", "MCP_INTERNAL_SECRET", "AUTH_SERVICE_URL"]) {
    if (!process.env[key]) {
      log("error", `Missing required environment variable: ${key}`);
      process.exit(1);
    }
  }
}

validateEnv();

const MCP_INTERNAL_SECRET = process.env["MCP_INTERNAL_SECRET"]!;
const AUTH_SERVICE_URL = process.env["AUTH_SERVICE_URL"]!;

/**
 * Resolve the caller's allowed tools.
 *
 * Two paths:
 *   1. Internal service (sync, etc.): X-Internal-Secret header matches env var.
 *      Trusted — returns the caller-supplied allowedTools array (single-tool bypass).
 *   2. User request: requires userId + jwtToken.
 *      Calls auth-service /auth/introspect to get DB-sourced allowed_tools.
 *      The caller-supplied allowedTools array is IGNORED — a compromised AI container
 *      cannot forge permissions by passing a different list in the request body.
 *
 * Returns null if the token is invalid or revoked (caller should 401).
 */
async function resolveAllowedTools(
  callerSecret: string | undefined,
  callerAllowedTools: string[],
  jwtToken: string | undefined,
): Promise<string[] | null> {
  // Trusted internal service path (sync scheduler, etc.)
  if (callerSecret && callerSecret === MCP_INTERNAL_SECRET) {
    return callerAllowedTools;
  }

  // User request path — verify via auth-service, ignore caller-supplied list
  if (!jwtToken) return null;

  try {
    const response = await fetch(`${AUTH_SERVICE_URL}/auth/introspect`, {
      method: "GET",
      headers: { Authorization: `Bearer ${jwtToken}` },
    });

    if (!response.ok) return null;

    const body = (await response.json()) as {
      valid: boolean;
      allowed_tools?: string[];
    };

    if (!body.valid || !Array.isArray(body.allowed_tools)) return null;

    return body.allowed_tools;
  } catch (err) {
    log("error", "introspect_error", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/tool-call", async (req, res) => {
  const { toolName, toolArgs, requestId, allowedTools, jwtToken } = req.body as {
    toolName?: unknown;
    toolArgs?: unknown;
    requestId?: unknown;
    allowedTools?: unknown;
    jwtToken?: unknown;
  };

  if (
    typeof toolName !== "string" ||
    !toolName ||
    toolArgs === undefined ||
    toolArgs === null ||
    typeof toolArgs !== "object" ||
    Array.isArray(toolArgs) ||
    typeof requestId !== "string" ||
    !requestId
  ) {
    res.status(400).json({ error: "missing_fields", message: "toolName, toolArgs, requestId are required" });
    return;
  }

  const callerSecret = req.headers["x-internal-secret"] as string | undefined;
  const callerAllowedTools = Array.isArray(allowedTools) ? (allowedTools as string[]) : [];
  const token = typeof jwtToken === "string" ? jwtToken : undefined;

  const dbAllowedTools = await resolveAllowedTools(callerSecret, callerAllowedTools, token);

  if (dbAllowedTools === null) {
    log("warn", "permission_check_failed", { toolName, requestId, reason: "invalid_or_revoked_token" });
    res.status(401).json({ error: "unauthorized", message: "Token invalid, revoked, or missing" });
    return;
  }

  if (!checkPermission(toolName, dbAllowedTools)) {
    log("warn", "tool_denied", { toolName, requestId });
    res.status(403).json({ error: "tool_denied", message: `Tool '${toolName}' is not in allowed_tools` });
    return;
  }

  try {
    const result = await callMcpTool(toolName, toolArgs as Record<string, unknown>, requestId);
    res.status(200).json(result);
  } catch (err) {
    log("error", "tool_call_error", {
      toolName,
      requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: "internal_error", message: err instanceof Error ? err.message : String(err) });
  }
});

const port = Number(process.env["PORT"] ?? 4001);
app.listen(port, () => {
  log("info", `mcp-bridge listening on :${port}`);
});
