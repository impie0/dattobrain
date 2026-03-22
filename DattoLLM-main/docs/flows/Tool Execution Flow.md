---
tags:
  - platform/flow
  - mcp
  - tools
aliases:
  - tool-flow
  - tool-execution
type: Flow
description: Five-layer permission enforcement — prompt filter, ai-service gate (SEC-Cache-001), MCP Bridge (SEC-MCP-001), MCP registry, write gate (SEC-Write-001)
---

# Tool Execution Flow

> Part of the [[Datto RMM AI Platform|PLATFORM_BRAIN]] knowledge graph · **Flow** node

What happens from the moment the LLM decides to call a tool until the result is returned.

```mermaid
sequenceDiagram
    autonumber
    participant AI as AI Service
    participant BR as MCP Bridge
    participant MCP as MCP Server
    participant TM as Token Manager
    participant D as Datto API

    AI->>BR: {toolName, toolArgs, allowedTools, requestId}
    BR->>BR: toolName in allowedTools?

    alt NOT permitted
        BR->>AI: INSERT audit_logs {tool_denied}
        BR-->>AI: 403 + {isError:true, "not permitted"}
    else Permitted
        BR->>MCP: POST /mcp X-Internal-Secret + JSON-RPC
        MCP->>MCP: Validate secret header
        MCP->>TM: getToken()
        TM-->>MCP: cached or fresh OAuth token

        MCP->>D: GET /v2/... Authorization: Bearer <token>

        alt 200 OK
            D-->>MCP: JSON data
            MCP-->>BR: {result: {content: [{type:text, text:...}]}}
            BR-->>AI: {success:true, result}
        else 401 (token expired)
            MCP->>TM: invalidate + refresh
            MCP->>D: retry once
        else 429 / 5xx / timeout
            MCP-->>BR: {isError:true, result}
            BR-->>AI: {success:false, isError:true}
        end
    end
```

## Five-Layer Permission Model

> [!warning] Defense in Depth
> Every tool call must pass through ==five independent permission layers==. A single-layer bypass is insufficient for unauthorized access.

| Layer | Where | What it stops |
|---|---|---|
| **1 — Prompt** | [[Prompt Builder]] | Model never sees definitions of unauthorised tools |
| **1.5 — ai-service gate (SEC-Cache-001)** | `permissions.ts` + `chat.ts` / `legacyChat.ts` / `cachedQueries.ts` | Rejects tool names not in `allowedTools` before any execution — covers both cached and live paths |
| **2 — Bridge gate (SEC-MCP-001)** | [[MCP Bridge]] `index.ts` | Calls [[Auth Service]] introspect for DB-sourced `allowedTools`; ignores caller-supplied list |
| **3 — MCP registry** | [[MCP Server]] | `Unknown tool: x` error for unregistered names |
| **4 — Write gate (SEC-Write-001)** | [[ActionProposal]] / [[Write Tool State Machine]] | Write tools must be staged as a proposal and confirmed by the user before execution |

> [!info] SEC-Cache-001 — Cached Tool Permission Gate
> When `dataMode === "cached"`, tool calls bypass the [[MCP Bridge]] entirely and execute directly against `datto_cache_*` tables. Layer 1.5 is the **only hard gate** for cached tools. Three-point enforcement: call-site check, inner check in `executeCachedTool()`, and live pre-flight. Denials are audit-logged with `event_type = "tool_denied"` and metadata `{ sec: "SEC-Cache-001" }`.

## Related Nodes

[[MCP Bridge]] · [[MCP Server]] · [[Token Manager]] · [[RBAC System]] · [[AI Service]] · [[Chat Request Flow]] · [[ActionProposal]] · [[Prompt Builder]] · [[Tool Router]] · [[Auth Service]] · [[Datto Credential Isolation]] · [[Network Isolation]] · [[Write Tool State Machine]] · [[Tool Permissions Table]]
