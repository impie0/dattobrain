# AI Service

> Part of the [[Datto RMM AI Platform|claude]] knowledge graph · **Service** node

**Purpose:** Runs the Anthropic LLM. Manages conversation history, vector search, tool routing, agentic loop, and both synchronous (legacy) and SSE streaming chat.

**Build:** `./ai-service`
**Port:** `6001`
**Key env vars:** `DATABASE_URL`, `ANTHROPIC_API_KEY`, `MCP_BRIDGE_URL`, `EMBEDDING_SERVICE_URL`

## Dependencies

- [[PostgreSQL]] — chat_sessions, chat_messages, audit_logs, tool_policies, approvals
- [[Embedding Service]] — text → vector for semantic search
- [[MCP Bridge]] — tool call execution
- Anthropic API — LLM inference

## Source Files

| File | Role |
|---|---|
| `src/index.ts` | Express server, all route wiring |
| `src/legacyChat.ts` | `POST /api/chat` sync handler, history, tools |
| `src/chat.ts` | `POST /chat` SSE streaming handler |
| `src/admin.ts` | All `/api/admin/*` CRUD handlers |
| `src/approvals.ts` | `/api/approvals/*` user approval handlers |
| `src/history.ts` | Session/message load + save |
| `src/prompt.ts` | [[Prompt Builder]] |
| `src/toolRegistry.ts` | [[Tool Router]] — all 37 tool definitions |
| `src/mcpBridge.ts` | HTTP client to [[MCP Bridge]] |
| `src/vectorSearch.ts` | pgvector similarity queries |
| `src/sse.ts` | SSE event writers |
| `src/db.ts` | pg Pool singleton |

## Agentic Loop

`anthropic.messages.stream()` → on `tool_use` stop reason → `callTool()` → push tool result → repeat until `end_turn`.

## Related Nodes

[[Prompt Builder]] · [[Tool Router]] · [[MCP Bridge]] · [[Chat Request Flow]] · [[Tool Execution Flow]] · [[Chat Messages Table]] · [[RBAC System]] · [[Embedding Service]]
