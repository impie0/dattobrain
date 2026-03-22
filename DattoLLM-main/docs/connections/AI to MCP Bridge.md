---
type: Connection
from: "[[AI Service]]"
to: "[[MCP Bridge]]"
tags:
  - connection
---
# AI Service → MCP Bridge

> [!info] Key facts
> **Endpoint:** `POST /tool-call` | **Port:** 4001 | **Payload:** `{toolName, toolArgs, allowedTools, requestId}`

Called inside the orchestrator's agentic loop (see [[Chat Request Flow]]). The [[MCP Bridge]] validates `toolName` is in `allowedTools` before forwarding to [[MCP Server]]. Returns **403** if denied + logs to `audit_logs`.

> [!warning] Cached mode bypasses this connection
> When `dataMode === "cached"`, tool calls go directly to [[PostgreSQL]] cache tables via `executeCachedTool()`. The routing decision is per-tool: live-only tools (jobs, activity logs, system status) always go through the MCP Bridge even in cached mode. All other tools are routed to the local cache. See [[local-data|SEC-Cache-001]] for the permission gate that covers the cached path.

**Routing logic in `chat.ts`:**

```
CACHED mode + non-live-only tool → PostgreSQL cache (CACHED)
CACHED mode + live-only tool     → MCP Bridge (LIVE)
LIVE mode                        → MCP Bridge (LIVE)
```

Observability spans tag each tool call with `source: "postgres_cache"` or `"mcp_bridge→mcp_server→datto_api"` for tracing.

**See also:** [[Tool Execution Flow]] · [[MCP Bridge to MCP Server]] · [[RBAC System]] · [[local-data]]
