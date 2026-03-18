function log(level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>) {
  const line = JSON.stringify({ level, msg, ts: Date.now(), ...extra });
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callMcpTool(
  toolName: string,
  toolArgs: Record<string, unknown>,
  requestId: string
): Promise<{ success: boolean; result: unknown; isError?: boolean }> {
  const url = process.env["MCP_SERVER_URL"]! + "/mcp";
  const secret = process.env["MCP_INTERNAL_SECRET"]!;

  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: requestId,
    method: "tools/call",
    params: { name: toolName, arguments: toolArgs },
  });

  const delays = [1000, 2000, 4000];

  for (let attempt = 0; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
          "X-Internal-Secret": secret,
        },
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

      return { success: true, result: json.result };
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

  log("error", "mcp_server_unavailable", { requestId, toolName });
  return {
    success: false,
    isError: true,
    result: { content: [{ type: "text", text: "MCP Server unavailable" }] },
  };
}
