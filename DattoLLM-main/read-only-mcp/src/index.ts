#!/usr/bin/env node

import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { timingSafeEqual } from "node:crypto";

import { loadConfig, TokenManager } from "./auth.js";
import { createApiClient, type ToolDef } from "./api.js";

import { accountTools } from "./tools/account.js";
import { siteTools } from "./tools/sites.js";
import { deviceTools } from "./tools/devices.js";
import { alertTools } from "./tools/alerts.js";
import { jobTools } from "./tools/jobs.js";
import { auditTools } from "./tools/audit.js";
import { activityTools } from "./tools/activity.js";
import { filterTools } from "./tools/filters.js";
import { systemTools } from "./tools/system.js";

const allTools: ToolDef[] = [
  ...accountTools,
  ...siteTools,
  ...deviceTools,
  ...alertTools,
  ...jobTools,
  ...auditTools,
  ...activityTools,
  ...filterTools,
  ...systemTools,
];

const toolMap = new Map(allTools.map((t) => [t.name, t]));

// ── in-memory counters for /metrics ──────────────────────────────────────────
let requestsTotal = 0;
let errorsTotal = 0;
let dattoCallsTotal = 0;

function log(level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>) {
  const line = JSON.stringify({ level, msg, ts: Date.now(), ...extra });
  if (level === "error") console.error(line);
  else console.log(line);
}

function validateEnv() {
  const required = ["DATTO_API_KEY", "DATTO_API_SECRET", "MCP_INTERNAL_SECRET"];
  for (const key of required) {
    if (!process.env[key]) {
      log("error", `Missing required environment variable: ${key}`);
      process.exit(1);
    }
  }
}

function checkSecret(req: express.Request, res: express.Response): boolean {
  const provided = req.headers["x-internal-secret"];
  const expected = process.env["MCP_INTERNAL_SECRET"]!;

  if (typeof provided !== "string") {
    log("warn", "Request missing X-Internal-Secret header", { ip: req.ip });
    res.status(401).json({ error: "unauthorised" });
    errorsTotal++;
    return false;
  }

  const a = Buffer.from(provided.padEnd(64).slice(0, 64));
  const b = Buffer.from(expected.padEnd(64).slice(0, 64));

  if (a.length !== b.length || !timingSafeEqual(a, b) || provided !== expected) {
    log("warn", "Invalid X-Internal-Secret header", { ip: req.ip });
    res.status(401).json({ error: "unauthorised" });
    errorsTotal++;
    return false;
  }

  return true;
}

function buildMcpServer(api: ReturnType<typeof createApiClient>) {
  const server = new Server(
    { name: "read-only-mcp", version: "2.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = toolMap.get(name);

    if (!tool) {
      errorsTotal++;
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    dattoCallsTotal++;
    const result = await tool.handler(api, (args ?? {}) as Record<string, unknown>);
    if (result.isError) errorsTotal++;
    return result;
  });

  return server;
}

async function main() {
  validateEnv();

  const config = loadConfig();
  const tokenManager = new TokenManager(
    config.apiKey,
    config.apiSecret,
    `${config.baseUrl.replace(/\/api$/, "")}/auth/oauth/token`
  );
  const api = createApiClient(config.baseUrl, tokenManager);

  const app = express();
  app.use(cors());
  app.use(express.json());

  // ── health ────────────────────────────────────────────────────────────────
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", version: "2.0.0", tools: allTools.length });
  });

  // ── metrics ───────────────────────────────────────────────────────────────
  app.get("/metrics", (_req, res) => {
    res.type("text/plain").send(
      [
        `mcp_requests_total ${requestsTotal}`,
        `mcp_errors_total ${errorsTotal}`,
        `mcp_datto_calls_total ${dattoCallsTotal}`,
      ].join("\n")
    );
  });

  // ── MCP endpoint ──────────────────────────────────────────────────────────
  app.post("/mcp", async (req, res) => {
    if (!checkSecret(req, res)) return;

    requestsTotal++;
    log("info", "mcp request", { tool: req.body?.params?.name });

    try {
      const server = buildMcpServer(api);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);

      res.on("finish", () => {
        transport.close();
        server.close();
      });
    } catch (err) {
      errorsTotal++;
      log("error", "mcp handler error", {
        error: err instanceof Error ? err.message : String(err),
      });
      if (!res.headersSent) {
        res.status(500).json({ error: "internal_error" });
      }
    }
  });

  const port = Number(process.env["PORT"] ?? 3001);
  const httpServer = createServer(app);

  httpServer.listen(port, () => {
    log("info", `MCP server listening on :${port}`, {
      tools: allTools.length,
      platform: config.platform,
    });
  });

  const shutdown = async () => {
    log("info", "shutting down");
    httpServer.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(JSON.stringify({ level: "error", msg: "startup failed", error: String(err), ts: Date.now() }));
  process.exit(1);
});
