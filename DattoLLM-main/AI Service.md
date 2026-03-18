---
tags:
  - platform/service
  - ai
  - llm
type: Service
description: Two-stage LLM pipeline with tool routing, vector search, and conversation history
---

# AI Service

> Part of the [[Datto RMM AI Platform|claude]] knowledge graph · **Service** node

**Purpose:** Runs the Anthropic LLM. Manages conversation history, vector search, tool routing, agentic loop, and both synchronous (legacy) and SSE streaming chat.

**Build:** `./ai-service`
**Port:** `6001`
**Key env vars:** `DATABASE_URL`, `MCP_BRIDGE_URL`, `EMBEDDING_SERVICE_URL`, `LITELLM_URL`, `LITELLM_MASTER_KEY` (required when `LITELLM_URL` set), `AUTH_SERVICE_URL`

## Dependencies

- [[PostgreSQL]] — chat_sessions, chat_messages, audit_logs, tool_policies, approvals
- [[Embedding Service]] — text → vector for semantic search
- [[MCP Bridge]] — tool call execution
- Anthropic API — LLM inference

## Source Files

| File | Role |
|---|---|
| `src/index.ts` | Express server, all route wiring |
| `src/legacyChat.ts` | `POST /api/chat` sync handler — two-stage loop (orchestrator + synthesizer) |
| `src/chat.ts` | `POST /chat` SSE streaming handler — two-stage loop with streaming synthesizer |
| `src/admin.ts` | All `/api/admin/*` CRUD handlers incl. LLM routing config |
| `src/approvals.ts` | `/api/approvals/*` user approval handlers |
| `src/history.ts` | Session/message load + save |
| `src/prompt.ts` | [[Prompt Builder]] + `buildSynthesizerPrompt` |
| `src/llmConfig.ts` | Routing config DB accessor (60s cache) + routing decision functions |
| `src/modelRouter.ts` | Single `llmClient` (OpenAI SDK via LiteLLM `/v1`), `synthesize()`, `synthesizeStream()` |
| `src/toolRegistry.ts` | [[Tool Router]] — thin re-export shim; definitions live in `src/tools/` (ARCH-002) |
| `src/mcpBridge.ts` | HTTP client to [[MCP Bridge]] |
| `src/vectorSearch.ts` | pgvector similarity queries |
| `src/sse.ts` | SSE event writers |
| `src/db.ts` | pg Pool singleton |
| `src/sync.ts` | Local data cache sync pipeline — rate-limited MCP calls → upsert cache tables; PostgreSQL advisory locks prevent concurrent runs (SEC-011) |
| `src/cachedQueries.ts` | SQL query handlers for all 28 cacheable tools |
| `src/dataBrowser.ts` | [[Data Explorer]] REST handlers — read-only SQL against cache tables |

## Two-Stage Pipeline

Stage 1 (Orchestrator): calls MCP tools in a loop using the OpenAI SDK via LiteLLM until all data is gathered. Breaks early if accumulated context exceeds 100,000 chars (SEC-015).
Stage 2 (Synthesizer): reads tool results and writes the final response using the OpenAI SDK via LiteLLM.
Stage 2 is skipped if Stage 1 called zero tools — Stage 1 text is sent directly.
Model selection per stage is driven by `llmConfig.ts` reading from the `llm_routing_config` DB table.

## Related Nodes

[[Prompt Builder]] · [[Tool Router]] · [[MCP Bridge]] · [[Chat Request Flow]] · [[Tool Execution Flow]] · [[Chat Messages Table]] · [[RBAC System]] · [[Embedding Service]]
