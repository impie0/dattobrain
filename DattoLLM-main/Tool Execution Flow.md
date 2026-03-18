# Tool Execution Flow

> Part of the [[Datto RMM AI Platform|claude]] knowledge graph · **Flow** node

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

## Three-Layer Permission Model

| Layer | Where | What it stops |
|---|---|---|
| **1 — Prompt** | [[Prompt Builder]] | Model never sees definitions of unauthorised tools |
| **2 — Bridge gate** | [[MCP Bridge]] `validate.ts` | 403 on any tool not in `allowedTools` |
| **3 — MCP registry** | [[MCP Server]] | `Unknown tool: x` error for unregistered names |

## Related Nodes

[[MCP Bridge]] · [[MCP Server]] · [[Token Manager]] · [[RBAC System]] · [[AI Service]] · [[Chat Request Flow]]
