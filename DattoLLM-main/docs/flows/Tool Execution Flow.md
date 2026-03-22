---
tags:
  - platform/flow
  - mcp
  - tools
aliases:
  - tool-flow
  - tool-execution
type: Flow
description: Six-layer permission enforcement — pre-query gate, prompt filter, ai-service gate (SEC-Cache-001), MCP Bridge (SEC-MCP-001), MCP registry, write gate (SEC-Write-001)
---

# Tool Execution Flow

> Part of the [[Datto RMM AI Platform|PLATFORM_BRAIN]] knowledge graph · **Flow** node

What happens from the moment the LLM decides to call a tool until the result is returned. Two paths exist depending on data mode.

```mermaid
sequenceDiagram
    autonumber
    participant AI as AI Service
    participant DB as PostgreSQL
    participant BR as MCP Bridge
    participant MCP as MCP Server
    participant TM as Token Manager
    participant D as Datto API

    AI->>AI: SEC-Cache-001: toolName in allowedTools?
    alt NOT permitted
        AI->>DB: INSERT audit_logs {tool_denied, sec: "SEC-Cache-001"}
        AI-->>AI: return error "not permitted"
    else Permitted
        alt CACHED mode (dataMode === "cached" && !isLiveOnlyTool)
            AI->>DB: executeCachedTool() against datto_cache_* tables
            DB-->>AI: JSON result (local data)
            AI->>AI: Truncate if > 8,000 chars
        else LIVE mode (dataMode === "live" or live-only tool)
            AI->>BR: {toolName, toolArgs, allowedTools, requestId}
            BR->>BR: SEC-MCP-001: introspect → toolName in allowedTools?
            alt NOT permitted (bridge)
                BR->>AI: INSERT audit_logs {tool_denied}
                BR-->>AI: 403 + {isError:true, "not permitted"}
            else Permitted (bridge)
                BR->>MCP: POST /mcp X-Internal-Secret + JSON-RPC
                MCP->>MCP: Validate secret header
                MCP->>TM: getToken()
                TM-->>MCP: cached or fresh OAuth token
                MCP->>D: GET /v2/... Authorization: Bearer <token>
                alt 200 OK
                    D-->>MCP: JSON data
                    MCP-->>BR: {result: {content: [{type:text, text:...}]}}
                    BR-->>AI: {success:true, result}
                    AI->>AI: Truncate if > 8,000 chars
                else 401 (token expired)
                    MCP->>TM: invalidate + refresh
                    MCP->>D: retry once
                else 429 / 5xx / timeout
                    MCP-->>BR: {isError:true, result}
                    BR-->>AI: {success:false, isError:true}
                end
            end
        end
    end
```

## CACHED vs LIVE Paths

| Aspect | CACHED | LIVE |
|---|---|---|
| Data source | `datto_cache_*` tables in [[PostgreSQL]] | Datto API via [[MCP Bridge]] → [[MCP Server]] |
| Latency | ~5-50ms (local SQL) | ~200-2000ms (API round-trip) |
| Freshness | Last sync (see [[Local Data Cache]]) | Real-time |
| Permission gate | SEC-Cache-001 only (Layer 1.5) | SEC-Cache-001 (Layer 1.5) + SEC-MCP-001 (Layer 2) + MCP registry (Layer 3) |
| Unfiltered blocking | `executeCachedTool()` rejects unfiltered list calls to prevent 150K+ token dumps | N/A — API handles pagination |

## Truncation

All tool results are capped at **8,000 characters** (`MAX_TOOL_RESULT_CHARS`). If a result exceeds this limit, it is truncated with a suffix message advising narrower filters. This applies to both CACHED and LIVE paths.

## Six-Layer Permission Model

> [!warning] Defense in Depth
> Every tool call must pass through ==six independent permission layers==. A single-layer bypass is insufficient for unauthorized access.

| Layer | Where | What it stops |
|---|---|---|
| **0 — Pre-query gate** | `preQuery.ts` | Each pre-query pattern requires a specific tool permission; if user lacks it, falls through silently |
| **1 — Prompt** | [[Prompt Builder]] | Model never sees definitions of unauthorised tools |
| **1.5 — ai-service gate (SEC-Cache-001)** | `permissions.ts` + `chat.ts` / `legacyChat.ts` / `cachedQueries.ts` | Rejects tool names not in `allowedTools` before any execution — covers both cached and live paths |
| **2 — Bridge gate (SEC-MCP-001)** | [[MCP Bridge]] `index.ts` | Calls [[Auth Service]] introspect for DB-sourced `allowedTools`; ignores caller-supplied list |
| **3 — MCP registry** | [[MCP Server]] | `Unknown tool: x` error for unregistered names |
| **4 — Write gate (SEC-Write-001)** | [[ActionProposal]] / [[Write Tool State Machine]] | Write tools must be staged as a proposal and confirmed by the user before execution |

> [!info] SEC-Cache-001 — Cached Tool Permission Gate
> When `dataMode === "cached"`, tool calls bypass the [[MCP Bridge]] entirely and execute directly against `datto_cache_*` tables. Layer 1.5 is the **only hard gate** for cached tools. Three-point enforcement: call-site check, inner check in `executeCachedTool()`, and live pre-flight. Denials are audit-logged with `event_type = "tool_denied"` and metadata `{ sec: "SEC-Cache-001" }`.

## Related Nodes

[[MCP Bridge]] · [[MCP Server]] · [[Token Manager]] · [[RBAC System]] · [[AI Service]] · [[Chat Request Flow]] · [[ActionProposal]] · [[Prompt Builder]] · [[Tool Router]] · [[Auth Service]] · [[Datto Credential Isolation]] · [[Network Isolation]] · [[Write Tool State Machine]] · [[Tool Permissions Table]]
