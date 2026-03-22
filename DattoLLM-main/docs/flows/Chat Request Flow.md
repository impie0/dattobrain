---
tags:
  - platform/flow
  - ai
  - chat
aliases:
  - chat-flow
  - chat-request
type: Flow
description: Full path of a user message through gateway, embedding, vector search, two-stage LLM pipeline, and tool calls to final response
---

# Chat Request Flow

> Part of the [[Datto RMM AI Platform|PLATFORM_BRAIN]] knowledge graph · **Flow** node

End-to-end path of a user message from browser to LLM response, including tool calls and the two-stage pipeline.

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

    note over AI: Stage 1 — Orchestrator (OpenAI SDK → LiteLLM → claude-*)
    AI->>AI: llmClient.chat.completions (streaming, with tools)

    loop Agentic loop until stop_reason != tool_calls
        AI->>BR: POST /tool-call {toolName, toolArgs, allowedTools}
        BR->>BR: checkPermission → 403 if not allowed
        BR->>MCP: POST /mcp JSON-RPC tools/call
        MCP-->>BR: {result: {content: [...]}}
        BR-->>AI: tool result
    end

    alt Stage 1 called zero tools
        AI-->>B: Stage 1 text sent directly (Stage 2 skipped)
    else Stage 1 called tools
        note over AI: Stage 2 — Synthesizer (OpenAI SDK → LiteLLM → any model)
        AI->>AI: buildSynthesizerPrompt + synthesize()/synthesizeStream()
        AI->>DB: INSERT chat_sessions (upsert) + chat_messages (user + assistant)
        AI->>DB: INSERT audit_logs {tool_call} per tool used
        AI-->>B: 200 {conversation_id, answer}
    end
```

## Two-Stage Pipeline

| Stage | Name | Model | Purpose |
|---|---|---|---|
| 1 | Orchestrator | Must be `claude-*` | Calls MCP tools in a loop until all data is gathered |
| 2 | Synthesizer | Any model (via LiteLLM) | Reads tool results, writes final response |

Stage 2 is **skipped entirely** if Stage 1 called zero tools — Stage 1 text is sent directly.
Model selection per stage is driven by [[AI Service]] `llmConfig.ts` reading from `llm_routing_config` DB table in [[PostgreSQL]].

Both stages use the **OpenAI SDK** (`llmClient`) via LiteLLM's `/v1/chat/completions` endpoint.

## Two Chat Modes

| Mode | Route | Format | File |
|---|---|---|---|
| Legacy (sync) | `POST /api/chat` | `{conversation_id, answer}` | `legacyChat.ts` |
| Streaming (SSE) | `POST /chat` | `event: delta` stream | `chat.ts` |

> [!success] SEC-003 / SEC-Write-001 — Write tool staging (RESOLVED)
> The [[ActionProposal]] state machine (`ai-service/src/actionProposals.ts`, migration `db/015_action_proposals.sql`) ensures write tools cannot execute directly. The LLM stages a proposal → user confirms within 15 min → platform executes. No write tools exist yet, but the infrastructure is in place.
> Additionally, SEC-Cache-001 adds a hard permission gate (`permissions.ts`) that validates every tool name against `allowedTools` before any execution — covering both cached and live paths.

## Related Nodes

[[AI Service]] · [[Prompt Builder]] · [[Tool Router]] · [[Tool Execution Flow]] · [[Chat Messages Table]] · [[Embedding Service]] · [[API Gateway]] · [[MCP Bridge]] · [[MCP Server]] · [[PostgreSQL]] · [[JWT Model]] · [[RBAC System]] · [[Web App]] · [[ActionProposal]] · [[Network Isolation]]
