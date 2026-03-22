---
tags:
  - roadmap
  - planning
type: Planning
description: Implementation roadmap — phases, priorities, and architectural decisions required before each phase
aliases:
  - Roadmap
---

# Platform Roadmap · Design history: [[PLATFORM_PLAN]]

> [!warning] PLANNING DOCUMENT
> This is a living roadmap. For current implementation state, see [[PLATFORM_BRAIN]] or [[ARCHITECTURE]].

> [!info] How to read this
> Each phase has a gate: the security and architecture items that **must** be resolved before that phase can ship. See [[SECURITY_FINDINGS]] for full detail on each issue.

---

## Phase 0 — Production-ready read-only (current state + hardening)

**Gate: resolve before any real users**

- [x] SEC-006 — Rate limit `POST /api/auth/login` in APISIX ✅ `setup-apisix.sh` limit-req plugin (route 1)
- [x] SEC-007 — Require `LITELLM_MASTER_KEY` (startup check in ai-service) ✅ `validateEnv()`
- [x] SEC-002 — JWT revocation via JTI + Redis revocation set ✅ `auth-service/src/redis.ts` + APISIX Lua JTI check
- [x] SEC-008 — Forced-revoke admin action ✅ `POST /api/admin/users/:id/revoke` + `revokeAllForUser()`
- [x] SEC-010 — PgBouncer connection pooling ✅ `services/pgbouncer/pgbouncer.ini` session mode
- [x] SEC-011 — Distributed lock on sync ✅ PostgreSQL advisory locks in `sync.ts`
- [x] SEC-012 — Alert staleness indication ✅ `ALERT_CACHED_NOTE()` warns at > 30 min
- [x] SEC-016 — Sync health endpoint + staleness watchdog ✅ `GET /api/admin/sync/health`
- [x] SEC-015 — Context overflow protection in agentic loop ✅ 100k char break in `chat.ts` + `legacyChat.ts`
- [x] SEC-013 — `orchestrator_high_risk` scope vs execution — documented as intentional ✅ ADR-003 resolved
- [x] SEC-014 — Migrate IVFFlat → HNSW index on `chat_messages` ✅ `db/014_hnsw_index.sql`
- [x] ARCH-001 — Pin LiteLLM to specific release version ✅ (pinned to `v1.82.3-stable`)
- [x] ARCH-002 — Modularize `toolRegistry.ts` by domain ✅ `ai-service/src/tools/` — 9 domain files, thin re-export shim ([[Tool Router]])

---

## Post-Phase-0 Implementation Stages

Incremental improvements shipped after Phase 0 hardening.

- [x] **Stage 1 — Security fixes** — cross-user session hijack (`history.ts` user_id filter), tool arg parse (error instead of empty `{}`), rate limiting (10 req/min), tool denial normalization
- [x] **Stage 2 — Truncation** — context overflow protection and large-result handling
- [x] **Stage 3 — Materialized views** — 5 views (`mv_fleet_status`, `mv_site_summary`, `mv_critical_alerts`, `mv_os_distribution`, `mv_alert_priority`) refreshed after every sync; migration 025
- [x] **Stage 4 — Pre-query** — pre-query system resolves common questions from materialized views without invoking the full agentic loop
- [x] **Stage 5 — Ollama** — local model support via Ollama backend through LiteLLM
- [ ] **Stage 6 — Local routing** — PARTIAL: works but slow on CPU; needs GPU or quantized models for production use

---

## Phase 1 — Write tools (device management)

**Gate: ALL of Phase 0, plus:**

- [ ] SEC-001 — MCP Bridge independent permission verification (DB/Redis, not caller-supplied)
- [ ] SEC-003 — Action staging state machine — see [[Write Tool State Machine]] for full spec
- [ ] SEC-004 — Split `mcp-read` / `mcp-write` containers with separate Datto credentials ([[Datto Credential Isolation]])
- [ ] SEC-005 — Audit log immutability (PostgreSQL RLS, INSERT-only role)
- [ ] SEC-009 — Audit parameter masking for sensitive tool arguments

**Architectural decisions required before Phase 1:**

#### Decision: Write tool scope

Define the exact set of write operations for Phase 1. Candidates:

> [!tip] Full design available
> The complete state machine design, DB schema, API endpoints, SSE events, prompt changes, and security properties are specified in [[Write Tool State Machine]]. Implement from that document directly.
- `reboot-device` — low risk, easily reversible
- `run-script` — high risk, requires especially careful approval flow
- `mute-alert` — low risk
- `reset-agent` — medium risk

Recommendation: start with `reboot-device` and `mute-alert` only. `run-script` warrants a separate phase.

#### Decision: Approval flow UX

The action staging state machine (SEC-003) requires a UI pattern for approval cards. Decide before writing any chat pipeline code:
- Inline approval card in the chat stream (SSE `action_proposal` event)
- Separate `/approvals` page with pending actions (existing page — already wired for this)
- Both (card inline + approval history in `/approvals`)

The `approvals` table already exists and is partially wired. The gap is connecting it to the agentic loop.

#### Decision: Write tool Datto credential scoping

Datto API credentials can be scoped at the API key level. Before Phase 1, create a write-scoped API key in the Datto portal with only the permissions needed for Phase 1 tools. Document which Datto API permissions map to which tools.

---

## Phase 2 — Multi-tenant / MSP mode

**Gate: ALL of Phase 1**

Support multiple Datto RMM accounts under one platform instance. Each tenant gets isolated:
- Separate MCP Server instance (or tenant-scoped credential injection)
- Tenant ID in JWT claims
- Row-level security on all chat/audit tables by tenant

**Major architectural work required — design separately.**

---

## Architecture Decisions Log

### ADR-001 — Orchestrator SDK: OpenAI via LiteLLM (resolved)

**Decision:** Both Stage 1 and Stage 2 use the OpenAI SDK (`llmClient`) via LiteLLM `/v1/chat/completions`. The Anthropic SDK (`anthropicClient`) exists only as a direct fallback when `LITELLM_URL` is absent.

**Rationale:** LiteLLM handles Anthropic format translation internally. All tool calls use OpenAI format (`tool_calls` array + `role: "tool"` messages). Claude models route via OpenRouter with dot notation IDs (e.g. `anthropic/claude-haiku-4.5`).

**Status:** Resolved. Node files updated to reflect this.

---

### ADR-002 — Alert caching strategy (open)

**Options:**
1. Always-live — simplest, eliminates staleness problem, increases Datto API load
2. 5-minute sync — good balance, requires tighter rate limit budget
3. 1-hour sync + staleness indicator — current approach, acceptable for non-critical use

**Decision needed:** Before Phase 0 ships to real users.

---

### ADR-003 — `orchestrator_high_risk` trigger logic (resolved)

**Decision:** Option 1 — **scope-based** for orchestrator, execution-based for synthesizer (already implemented).

**Rationale:** Scope-based orchestrator routing pre-selects the smarter/more-cautious model before the loop begins, ensuring it never misses a boundary when high-risk tools are in scope. Synthesizer is execution-based since it only needs to handle what was actually called.

**Trade-off:** Admin users pay `orchestrator_high_risk` cost for all queries. Accepted for Phase 0 (read-only tools only). Revisit before write tools ship — consider upgrading mid-loop if needed.

**Documented in:** `ai-service/src/llmConfig.ts` `selectOrchestratorModel()` JSDoc.

---

## Related Nodes

[[SECURITY_FINDINGS]] · [[ARCHITECTURE]] · [[MCP Bridge]] · [[MCP Server]] · [[Auth Service]] · [[AI Service]] · [[Chat Request Flow]] · [[Write Tool State Machine]] · [[Network Isolation]]
