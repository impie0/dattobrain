---
tags:
  - platform/module
  - auth
  - datto
type: Module
aliases:
  - OAuth Token Cache
  - Datto Token Manager
description: In-memory Datto OAuth token cache inside MCP Server, plus per-stage LLM token tracking in llm_request_logs
---

# Token Manager

> Part of the [[Datto RMM AI Platform|PLATFORM_BRAIN]] knowledge graph · **Module** node

This node covers two distinct "token" concepts in the platform:

1. **Datto OAuth Token Cache** — in-memory cache inside [[MCP Server]] preventing redundant OAuth round-trips
2. **LLM Token Tracking** — per-stage, per-provider token accounting stored in `llm_request_logs`

---

## 1. Datto OAuth Token Cache

**Purpose:** In-memory Datto OAuth token cache inside [[MCP Server]]. Prevents redundant OAuth calls across concurrent tool requests.

**File:** `read-only-mcp/src/index.ts` (inline class)

### Functions

| Function | Description |
|---|---|
| `getToken()` | Return cached token or fetch new one |
| `refreshToken()` | POST to Datto `/auth/oauth/token`, store result + `expiresAt` |
| `invalidate()` | Clear cache on 401 response from Datto |

### Logic

```
if (Date.now() < expiresAt - 5min) return cached
else refreshToken()
```

> [!tip] Automatic recovery
> On 401 from Datto API, the token manager automatically invalidates, refreshes, and retries once.

On 401 from Datto API:
1. `invalidate()` — clears cached token
2. `refreshToken()` — fetches new OAuth token
3. Retry original request once

**Called by:** Tool handlers in [[MCP Server]]
**Calls:** `POST *.centrastage.net/auth/oauth/token`

---

## 2. LLM Token Tracking

**Purpose:** Per-stage, per-provider token accounting for cost monitoring and the [[Observability Dashboard]].

**Stored in:** `llm_request_logs` table (in [[PostgreSQL]])

### Per-Stage Columns

| Column | Stage | Description |
|---|---|---|
| `orch_prompt_tokens` | Orchestrator (Stage 1) | Input tokens for orchestrator call |
| `orch_completion_tokens` | Orchestrator (Stage 1) | Output tokens for orchestrator call |
| `orch_total_tokens` | Orchestrator (Stage 1) | Sum of prompt + completion |
| `orch_iterations` | Orchestrator (Stage 1) | Number of agentic loop iterations |
| `synth_prompt_tokens` | Synthesizer (Stage 2) | Input tokens for synthesizer call |
| `synth_completion_tokens` | Synthesizer (Stage 2) | Output tokens for synthesizer call |
| `synth_total_tokens` | Synthesizer (Stage 2) | Sum of prompt + completion |

### Per-Provider Columns

| Column | Description |
|---|---|
| `orchestrator_provider` | `cloud` or `ollama` — where Stage 1 ran |
| `synth_provider` | `cloud` or `ollama` — where Stage 2 ran |
| `data_mode` | `cached` or `live` — affects synthesizer model selection |

**Written by:** `legacyChat.ts` and `chat.ts` after each request completes
**Read by:** [[Observability Dashboard]] LLM page for per-stage token breakdown and provider split

## Related Nodes

[[MCP Server]] · [[Datto Credential Isolation]] · [[Tool Execution Flow]] · [[MCP Bridge]] · [[Network Isolation]] · [[Tool Router]]
