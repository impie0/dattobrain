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
  for (const key of ["MCP_SERVER_URL", "MCP_INTERNAL_SECRET"]) {
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

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/tool-call", async (req, res) => {
  const { toolName, toolArgs, requestId, allowedTools } = req.body as {
    toolName?: unknown;
    toolArgs?: unknown;
    requestId?: unknown;
    allowedTools?: unknown;
  };

  if (
    typeof toolName !== "string" ||
    !toolName ||
    toolArgs === undefined ||
    toolArgs === null ||
    typeof toolArgs !== "object" ||
    Array.isArray(toolArgs) ||
    typeof requestId !== "string" ||
    !requestId ||
    !Array.isArray(allowedTools)
  ) {
    res.status(400).json({ error: "missing_fields", message: "toolName, toolArgs, requestId, allowedTools are required" });
    return;
  }

  if (!checkPermission(toolName, allowedTools as string[])) {
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
