---
tags:
  - platform/service
  - ai
  - llm
aliases:
  - ai-service
type: Service
description: Two-stage LLM pipeline with pre-query engine, materialized view tools, tool routing, vector search, and conversation history
---

# AI Service

> Part of the [[Datto RMM AI Platform|PLATFORM_BRAIN]] knowledge graph · **Service** node

**Purpose:** Runs the LLM pipeline. Manages conversation history, vector search, tool routing, agentic loop, pre-query engine, materialized view tools, and both synchronous (legacy) and SSE streaming chat.

> [!info] Service Details
> **Build:** `./ai-service`
> **Port:** `6001`
> **Key env vars:** `DATABASE_URL`, `MCP_BRIDGE_URL`, `EMBEDDING_SERVICE_URL`, `LITELLM_URL`, `LITELLM_MASTER_KEY` (required when `LITELLM_URL` set), `AUTH_SERVICE_URL`

## Dependencies

- [[PostgreSQL]] — chat_sessions, chat_messages, audit_logs, tool_policies, approvals, materialized views
- [[Embedding Service]] — text → vector for semantic search
- [[MCP Bridge]] — tool call execution
- LLM inference routed via [[LiteLLM]] (cloud providers via OpenRouter + local [[Ollama]])

## Source Files

| File | Role |
|---|---|
| `src/index.ts` | Express server, all route wiring, per-user rate limiting (10 req/min) |
| `src/legacyChat.ts` | `POST /api/chat` sync handler — two-stage loop (orchestrator + synthesizer) |
| `src/chat.ts` | `POST /chat` SSE streaming handler — two-stage loop with streaming synthesizer, tracing, pre-query |
| `src/preQuery.ts` | **Pre-query engine** — regex pattern matching → direct DB/MV answers, 0 LLM tokens (Stage 4) |
| `src/admin.ts` | All `/api/admin/*` CRUD handlers incl. LLM routing config |
| `src/approvals.ts` | `/api/approvals/*` user approval handlers |
| `src/history.ts` | Session/message load + save |
| `src/prompt.ts` | [[Prompt Builder]] + `buildSynthesizerPrompt` |
| `src/llmConfig.ts` | Routing config DB accessor (60s cache) + routing decision functions |
| `src/modelRouter.ts` | Single `llmClient` (OpenAI SDK via LiteLLM `/v1`), `synthesize()`, `synthesizeStream()` |
| `src/toolRegistry.ts` | [[Tool Router]] — thin re-export shim; definitions live in `src/tools/` (ARCH-002) |
| `src/tools/fleet.ts` | **Materialized view tools** — `get-fleet-status`, `list-site-summaries`, `list-critical-alerts` (Stage 3) |
| `src/mcpBridge.ts` | HTTP client to [[MCP Bridge]] |
| `src/vectorSearch.ts` | pgvector similarity queries |
| `src/sse.ts` | SSE event writers |
| `src/db.ts` | pg Pool singleton |
| `src/tracing.ts` | Distributed tracing — `TraceContext` for span creation and lifecycle |
| `src/traceHandlers.ts` | Trace admin endpoints + span ingestion from [[MCP Bridge]] |
| `src/sync.ts` | Local data cache sync pipeline — rate-limited MCP calls → upsert cache tables; PostgreSQL advisory locks prevent concurrent runs (SEC-011) |
| `src/cachedQueries.ts` | SQL query handlers for all 28 cacheable tools |
| `src/dataBrowser.ts` | [[Data Explorer]] REST handlers — read-only SQL against cache tables |
| `src/observability.ts` | [[Observability Dashboard]] — 6 admin endpoints aggregating metrics from audit_logs, llm_request_logs, chat_messages, chat_sessions, datto_sync_log |
| `src/permissions.ts` | SEC-Cache-001: Tool permission check + audit-log utility for cached and live paths — `isToolAllowed()`, `toolDeniedMessage()`, `checkAndAuditToolPermission()` |
| `src/actionProposals.ts` | [[ActionProposal]] state machine — stage/list/confirm/reject/execute write tool proposals (SEC-Write-001) |

## Pre-Query Engine (Stage 4)

Before invoking the LLM, `tryPreQuery()` in `src/preQuery.ts` pattern-matches the user's question against ~12 regex groups. If a pattern matches and the user has the required tool permission (RBAC check), the answer is served directly from PostgreSQL materialized views — **0 LLM tokens, instant response**.

Supported question categories:
- Fleet overview / summary → `mv_fleet_status`
- Device counts (total, online, offline) → `mv_fleet_status`
- Site counts → `mv_fleet_status`
- Alert counts + priority breakdown → `mv_fleet_status` + `mv_alert_priority`
- Top sites by alerts or devices → `mv_site_summary`
- Critical/urgent alerts → `mv_alert_priority` + `mv_critical_alerts`
- OS distribution → `mv_os_distribution`
- Last sync time → `mv_fleet_status`
- Specific site lookup (fuzzy) → `mv_site_summary`

Security: respects RBAC — checks `allowedTools` before executing. Audit: logs all pre-query hits to `audit_logs`.

## Materialized View Tools (Stage 3)

Three tools in `src/tools/fleet.ts` are backed by materialized views (defined in `db/025_materialized_views.sql`). These are placed **first** in the tool registry so the LLM sees them before heavier MCP tools:

| Tool | View(s) | Purpose |
|---|---|---|
| `get-fleet-status` | `mv_fleet_status` | Single-row fleet overview: device/site/alert counts, sync times |
| `list-site-summaries` | `mv_site_summary` | Per-site device counts and alert counts |
| `list-critical-alerts` | `mv_critical_alerts` + `mv_alert_priority` | Top 20 critical/high alerts + priority breakdown |

Views are refreshed concurrently after each data sync.

## Two-Stage Pipeline

Stage 1 (Orchestrator): calls MCP tools in a loop using the OpenAI SDK via LiteLLM until all data is gathered. Safety caps:
- **Context overflow** (SEC-015): breaks early if accumulated context exceeds 100,000 chars.
- **Max tool iterations**: capped at **12 iterations** to prevent runaway tool loops.
- **Tool arg parse fix**: invalid JSON args are rejected with an error message rather than defaulting to empty args (prevents full data dumps on list tools).
- **Individual tool result cap**: each tool result is hard-capped at 8,000 chars.

Stage 2 (Synthesizer): reads tool results and writes the final response. Large tool results are compressed (SEC-015b): the `compressForSynthesizer()` function truncates individual tool results to 12,000 chars when total context exceeds 120,000 chars.

Stage 2 is skipped if Stage 1 called zero tools — Stage 1 text is sent directly.
Model selection per stage is driven by `llmConfig.ts` reading from the `llm_routing_config` DB table.

## Data Mode Override

Data mode (cached vs live) is resolved with the following priority:
1. **Request body** — `data_mode` field sent by the client (persisted to session)
2. **Session DB** — previously set mode for the session
3. **Global default** — from `llm_routing_config` table

## Rate Limiting

Per-user rate limiting on chat endpoints: **10 requests per minute** per user (1-minute sliding window). Returns HTTP 429 when exceeded. Stale entries cleaned every 5 minutes.

## Tracing

Each chat request creates a `TraceContext` with detailed spans:
- **CACHED vs LIVE→MCP labels**: tool call spans are labeled `[toolName] CACHED` or `[toolName] LIVE→MCP` to distinguish data source
- **Token tracking**: orchestrator and synthesizer token counts (prompt, completion, total) logged to `llm_request_logs`
- **Pre-query spans**: pre-query hits are traced with `prequery_hit` operation, recording the matched tool and answer length
- **LiteLLM spans**: each LLM call (per stage/iteration) gets a `litellm → chat_completion` span with model, provider, and stage info
- Spans from [[MCP Bridge]] are ingested via `POST /api/internal/trace-spans`
- Traces are retained for 30 days (hourly cleanup)

## Connections

- [[connections/AI to MCP Bridge|AI → MCP Bridge]] — `POST /tool-call` for tool execution
- [[connections/AI to Embedding|AI → Embedding]] — `POST /embed` for vector search
- [[connections/AI to PostgreSQL|AI → PostgreSQL]] — chat history, audit logs, cache tables, materialized views
- [[connections/Gateway to AI|Gateway → AI]] — APISIX forwards `/api/chat`, `/api/history`, `/api/admin/*`

## Deep Dives

- [[local-data]] — Cache sync pipeline architecture
- [[local-llm]] — LLM routing and model configuration
- [[ARCHITECTURE]] — Full technical spec with code examples

## Related Nodes

[[Prompt Builder]] · [[Tool Router]] · [[MCP Bridge]] · [[Chat Request Flow]] · [[Tool Execution Flow]] · [[Chat Messages Table]] · [[RBAC System]] · [[Embedding Service]] · [[Observability Dashboard]] · [[Data Explorer]] · [[ActionProposal]] · [[PostgreSQL]] · [[API Gateway]] · [[Auth Service]] · [[Write Tool State Machine]] · [[Ollama]] · [[LiteLLM]]
