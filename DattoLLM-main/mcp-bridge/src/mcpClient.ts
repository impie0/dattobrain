function log(level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>) {
  const line = JSON.stringify({ level, msg, ts: Date.now(), ...extra });
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface TraceSpanData {
  id?: string;
  parentSpanId?: string;
  service: string;
  operation: string;
  status: "ok" | "error";
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  requestPayload?: unknown;
  responsePayload?: unknown;
  metadata?: Record<string, unknown>;
  errorMessage?: string;
}

export async function callMcpTool(
  toolName: string,
  toolArgs: Record<string, unknown>,
  requestId: string,
  traceId?: string,
  parentSpanId?: string,
): Promise<{ success: boolean; result: unknown; isError?: boolean; _traceSpans?: TraceSpanData[] }> {
  const url = process.env["MCP_SERVER_URL"]! + "/mcp";
  const secret = process.env["MCP_INTERNAL_SECRET"]!;

  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: requestId,
    method: "tools/call",
    params: { name: toolName, arguments: toolArgs },
  });

  const delays = [1000, 2000, 4000];
  const mcpSpans: TraceSpanData[] = [];
  const mcpCallStart = new Date();

  for (let attempt = 0; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "X-Internal-Secret": secret,
      };
      if (traceId) headers["X-Trace-Id"] = traceId;
      if (parentSpanId) headers["X-Parent-Span-Id"] = parentSpanId;

      const res = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.status === 401) {
        throw new Error("MCP Server rejected: unauthorised");
      }

      if (res.status === 503) {
        if (attempt < 3) {
          log("warn", "mcp_server_503_retry", { attempt, requestId });
          await sleep(delays[attempt]!);
          continue;
        }
        break;
      }

      if (!res.ok) {
        throw new Error(`MCP Server returned ${res.status}`);
      }

      const contentType = res.headers.get("content-type") ?? "";
      let json: { result?: unknown };

      if (contentType.includes("text/event-stream")) {
        // Parse SSE: extract first "data:" line and parse as JSON
        const text = await res.text();
        const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) throw new Error("No data line in SSE response");
        json = JSON.parse(dataLine.slice(5).trim()) as { result?: unknown };
      } else {
        json = (await res.json()) as { result?: unknown };
      }

      const mcpCallEnd = new Date();
      mcpSpans.push({
        parentSpanId,
        service: "mcp-server",
        operation: "mcp_tool_call",
        status: "ok",
        startedAt: mcpCallStart.toISOString(),
        endedAt: mcpCallEnd.toISOString(),
        durationMs: mcpCallEnd.getTime() - mcpCallStart.getTime(),
        requestPayload: { toolName, toolArgs },
        responsePayload: { resultPreview: JSON.stringify(json.result).slice(0, 500), resultSize: JSON.stringify(json.result).length },
        metadata: { toolName, attempts: attempt + 1 },
      });

      // Fetch Datto API call details from MCP server (best effort)
      if (traceId) {
        try {
          const baseUrl = process.env["MCP_SERVER_URL"]!;
          const traceRes = await fetch(`${baseUrl}/trace-spans`, {
            headers: { "X-Internal-Secret": secret },
          });
          if (traceRes.ok) {
            const traceBody = (await traceRes.json()) as { spans?: { url: string; method: string; statusCode: number; durationMs: number; responseSize: number; retried: boolean; error?: string }[] };
            if (traceBody.spans) {
              for (const ds of traceBody.spans) {
                mcpSpans.push({
                  parentSpanId,
                  service: "datto-api",
                  operation: "datto_api_call",
                  status: ds.error ? "error" : "ok",
                  startedAt: new Date(mcpCallStart.getTime()).toISOString(),
                  endedAt: new Date(mcpCallStart.getTime() + ds.durationMs).toISOString(),
                  durationMs: ds.durationMs,
                  requestPayload: { url: ds.url, method: ds.method },
                  responsePayload: { statusCode: ds.statusCode, responseSize: ds.responseSize },
                  metadata: { url: ds.url, statusCode: ds.statusCode, retried: ds.retried },
                  errorMessage: ds.error,
                });
              }
            }
          }
        } catch { /* best effort */ }
      }

      return { success: true, result: json.result, _traceSpans: mcpSpans };
    } catch (err) {
      clearTimeout(timeout);

      if (err instanceof Error && err.message === "MCP Server rejected: unauthorised") {
        throw err;
      }

      if (attempt < 3) {
        log("warn", "mcp_network_error_retry", {
          attempt,
          requestId,
          error: err instanceof Error ? err.message : String(err),
        });
        await sleep(delays[attempt]!);
        continue;
      }
      break;
    }
  }

  const mcpCallEnd = new Date();
  mcpSpans.push({
    parentSpanId,
    service: "mcp-server",
    operation: "mcp_tool_call",
    status: "error",
    startedAt: mcpCallStart.toISOString(),
    endedAt: mcpCallEnd.toISOString(),
    durationMs: mcpCallEnd.getTime() - mcpCallStart.getTime(),
    requestPayload: { toolName, toolArgs },
    metadata: { toolName },
    errorMessage: "MCP Server unavailable after retries",
  });

  log("error", "mcp_server_unavailable", { requestId, toolName });
  return {
    success: false,
    isError: true,
    result: { content: [{ type: "text", text: "MCP Server unavailable" }] },
    _traceSpans: mcpSpans,
  };
}
