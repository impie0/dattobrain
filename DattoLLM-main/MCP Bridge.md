---
tags:
  - platform/service
  - mcp
  - security
type: Service
description: Permission gate between AI Service and MCP Server — enforces allowed_tools before forwarding JSON-RPC tool calls
---

# MCP Bridge

> Part of the [[Datto RMM AI Platform|claude]] knowledge graph · **Service** node

**Purpose:** Permission gate and HTTP client between [[AI Service]] and [[MCP Server]]. Enforces `allowed_tools` check before any tool call reaches the MCP layer.

**Build:** `./mcp-bridge`
**Port:** `4001` (internal only)
**Key env vars:** `MCP_SERVER_URL`, `MCP_INTERNAL_SECRET`

> [!danger] SEC-001 — Trusts caller-supplied `allowedTools`
> The bridge validates tool calls against the `allowedTools` array supplied by the AI Service — it does **not** independently verify permissions against the DB. A compromised AI container can forge this array.
> For read tools this is a defense-in-depth gap. For write tools this is catastrophic.
> **Fix:** Bridge must query Redis/DB using `userId` and ignore caller-supplied permissions. See [[SECURITY_FINDINGS#SEC-001]].

## Dependencies

- [[MCP Server]] — forwards approved tool calls via JSON-RPC 2.0
- [[AI Service]] — caller

## Key Functions

File: `mcp-bridge/src/index.ts`

| Function | File | Purpose |
|---|---|---|
| `POST /tool-call` | `index.ts` | Validate fields → `checkPermission` → `callMcpTool` |
| `checkPermission` | `validate.ts` | Returns 403 if `toolName` not in `allowedTools` |
| `callMcpTool` | `mcpClient.ts` | POST JSON-RPC to MCP Server, retry 3× on 503 |

## Retry Policy

File: `mcpClient.ts`

- 401 → throw immediately
- 503 / network error → retry 1s / 2s / 4s backoff
- Exhausted → `{ isError: true, result: "MCP Server unavailable" }`

## Related Nodes

[[MCP Server]] · [[AI Service]] · [[Tool Execution Flow]] · [[RBAC System]] · [[Network Isolation]]
