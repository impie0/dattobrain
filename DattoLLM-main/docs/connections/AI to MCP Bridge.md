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
> When `dataMode === "cached"`, tool calls go directly to [[PostgreSQL]] cache tables. See [[local-data|SEC-Cache-001]] for the permission gate that covers this path.

**See also:** [[Tool Execution Flow]] · [[MCP Bridge to MCP Server]] · [[RBAC System]]
