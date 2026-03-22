---
tags:
  - platform/service
  - mcp
  - security
aliases:
  - mcp-bridge
  - bridge
type: Service
description: Permission gate between AI Service and MCP Server — enforces allowed_tools before forwarding JSON-RPC tool calls
---

# MCP Bridge

> Part of the [[Datto RMM AI Platform|PLATFORM_BRAIN]] knowledge graph · **Service** node

**Purpose:** Permission gate and HTTP client between [[AI Service]] and [[MCP Server]]. Enforces `allowed_tools` check before any tool call reaches the MCP layer.

> [!info] Service Details
> **Build:** `./mcp-bridge`
> **Port:** `4001` (internal only)
> **Key env vars:** `MCP_SERVER_URL`, `MCP_INTERNAL_SECRET`, `AUTH_SERVICE_URL`

> [!success] SEC-MCP-001 — Independent permission verification (RESOLVED)
> The bridge no longer trusts the `allowedTools` array supplied by the AI Service. Instead:
> - **Internal service path** (e.g. sync scheduler): `X-Internal-Secret` header matches `MCP_INTERNAL_SECRET` → caller is trusted, supplied `allowedTools` accepted.
> - **User request path**: bridge receives `jwtToken` from request body, calls `AUTH_SERVICE_URL/auth/introspect`, and uses the DB-sourced `allowed_tools` from that response. A compromised AI container cannot forge permissions.
>
> Additionally, SEC-Cache-001 adds a Layer 1.5 permission gate inside ai-service that validates every tool name against `allowedTools` BEFORE execution for both cached and live paths.

## Dependencies

- [[MCP Server]] — forwards approved tool calls via JSON-RPC 2.0
- [[AI Service]] — caller

## Key Functions

File: `mcp-bridge/src/index.ts`

| Function | File | Purpose |
|---|---|---|
| `POST /tool-call` | `index.ts` | Validate fields → `resolveAllowedTools` → `checkPermission` → `callMcpTool` |
| `resolveAllowedTools` | `index.ts` | SEC-MCP-001: Introspect JWT via auth-service to get DB-sourced `allowedTools`; trusts caller only if `X-Internal-Secret` matches |
| `checkPermission` | `validate.ts` | Returns 403 if `toolName` not in DB-sourced `allowedTools` |
| `callMcpTool` | `mcpClient.ts` | POST JSON-RPC to MCP Server, retry 3× on 503, collect trace spans |

## Retry Policy

File: `mcpClient.ts`

- 401 → throw immediately
- 503 / network error → retry 1s / 2s / 4s backoff
- Exhausted → `{ isError: true, result: "MCP Server unavailable" }`

## Tracing Spans

The bridge generates structured trace spans for every tool call request and sends them back to the [[AI Service]] via the `_traceSpans` field in the response body. The AI Service ingests these through `POST /api/internal/trace-spans`.

| Span Operation | Service | Description |
|---|---|---|
| `bridge_tool_call` | `mcp-bridge` | Top-level span wrapping the entire tool-call flow (permission + MCP call). Includes request/response payloads and duration |
| `permission_check` | `mcp-bridge` | Permission resolution — records whether internal-secret or JWT introspect path was used, and whether the tool was allowed |
| `token_introspect` | `auth-service` | JWT introspection call to auth-service `/auth/introspect`. Records validity, tool count, and any errors |
| `mcp_tool_call` | `mcp-server` | JSON-RPC call to [[MCP Server]]. Records tool name, args, result preview, result size, and retry count |
| `datto_api_call` | `datto-api` | Upstream Datto REST API call (fetched from MCP Server's `/trace-spans`). Records URL, method, status code, response size, retry flag |

Spans carry `X-Trace-Id` and `X-Parent-Span-Id` headers from the AI Service for cross-service correlation.

## Connections

- [[connections/AI to MCP Bridge|AI → MCP Bridge]] — receives tool call requests
- [[connections/MCP Bridge to MCP Server|MCP Bridge → MCP Server]] — forwards approved calls via JSON-RPC

## Related Nodes

[[MCP Server]] · [[AI Service]] · [[Tool Execution Flow]] · [[RBAC System]] · [[Network Isolation]] · [[Auth Service]] · [[Datto Credential Isolation]] · [[Tool Permissions Table]] · [[JWT Model]]
