# Chat Request Flow

> Part of the [[Datto RMM AI Platform|claude]] knowledge graph · **Flow** node

End-to-end path of a user message from browser to LLM response, including tool calls.

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant GW as API Gateway
    participant AI as AI Service
    participant E as Embedding Service
    participant DB as PostgreSQL
    participant BR as MCP Bridge
    participant MCP as MCP Server

    B->>GW: POST /api/chat {question} + Bearer JWT
    GW->>GW: Validate RS256 signature + exp
    GW->>GW: Lua: decode JWT → inject X-User-Id, X-User-Role, X-Allowed-Tools
    GW->>AI: Forward with injected headers

    par Load history
        AI->>DB: SELECT role,content FROM chat_messages WHERE session_id=$1 LIMIT 20
    and Embed + vector search
        AI->>E: POST /embed {text: question}
        E-->>AI: {vector: [...1024 dims]}
        AI->>DB: SELECT content,similarity FROM chat_messages WHERE user_id=$1 AND similarity>0.78 LIMIT 5
    end

    AI->>AI: Prompt Builder: tool defs (allowed only) + similar context + history
    AI->>AI: anthropic.messages.stream(model, system, messages, tools)

    loop Agentic loop until stop_reason != tool_use
        AI->>BR: POST /tool-call {toolName, toolArgs, allowedTools}
        BR->>BR: checkPermission → 403 if not allowed
        BR->>MCP: POST /mcp JSON-RPC tools/call
        MCP-->>BR: {result: {content: [...]}}
        BR-->>AI: tool result
    end

    AI->>DB: INSERT chat_sessions (upsert) + chat_messages (user + assistant)
    AI->>DB: INSERT audit_logs {tool_call} per tool used
    AI-->>B: 200 {conversation_id, answer}
```

## Two Chat Modes

| Mode | Route | Format | File |
|---|---|---|---|
| Legacy (sync) | `POST /api/chat` | `{conversation_id, answer}` | `legacyChat.ts` |
| Streaming (SSE) | `POST /chat` | `event: delta` stream | `chat.ts` |

## Related Nodes

[[AI Service]] · [[Prompt Builder]] · [[Tool Router]] · [[Tool Execution Flow]] · [[Chat Messages Table]] · [[Embedding Service]] · [[API Gateway]] · [[MCP Bridge]]
