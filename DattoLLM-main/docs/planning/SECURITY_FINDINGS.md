---
tags:
  - platform/security
  - review
  - planning
type: Planning
description: Security review findings — severity-ranked issues, remediation plans, and implementation status
aliases:
  - Security Findings
  - Security Review
---

# Security Findings

> [!warning] Pre-production blockers
> Issues marked **Critical** must be resolved before this platform handles real Datto credentials or external users. Issues marked **High** must be resolved before external users are onboarded.

---

## Critical — Must fix before production

### SEC-001 · MCP Bridge trusts caller-supplied `allowedTools`

**Severity:** Critical (catastrophic when write tools are added)
**Location:** [[MCP Bridge]] `src/validate.ts`, [[AI Service]] → bridge call

**Problem:**
The [[AI Service]] supplies its own `allowedTools` array to [[MCP Bridge]] in the request body. The bridge validates the tool call against this caller-supplied list — it does not independently verify permissions against the database. A compromised AI container can forge the `allowedTools` array and call any tool.

For the current read-only tool set this is a defense-in-depth gap. When write tools (reboot, script execution, password reset) are added, this becomes catastrophic — a single compromised container bypasses all RBAC.

**Remediation:**
1. Bridge receives `userId` (from the injected `X-User-Id` header, passed through by AI Service)
2. Bridge queries Redis (cached) or PostgreSQL directly for the user's allowed tools
3. Bridge ignores the caller-supplied `allowedTools` entirely — it is not trusted input
4. Cache TTL should match the JWT expiry (1h) and be invalidated on forced-revoke (SEC-002)

**Status:** Not implemented

---

### SEC-002 · No JWT revocation mechanism

**Severity:** Critical
**Location:** [[Auth Service]] `src/tokens.ts`, [[API Gateway]], [[JWT Model]]

**Problem:**
A stolen token is valid for the full 1-hour window with no way to force-invalidate it. There is no JTI (JWT ID) claim, no revocation list, and no admin action that can terminate an active session.

**Remediation:**
1. Add `jti: uuid_generate_v4()` claim to access token payload in `signAccessToken()`
2. Add `revoked_jtis` set in Redis (`SET revoked_jtis:<jti> 1 EX 3600`)
3. APISIX Lua serverless function: before passing request, check `EXISTS revoked_jtis:<jti>` — reject 401 if found
4. Add `POST /auth/revoke` endpoint in [[Auth Service]] (admin-only): writes JTI to Redis revocation set
5. Add `revokedAt` column to `refresh_tokens` table for refresh token revocation
6. Forced-revoke path: admin calls `/auth/revoke` with userId → revokes all active JTIs for that user (requires tracking issued JTIs per user in Redis or DB)

**Status:** ✅ Implemented — `auth-service/src/tokens.ts` `signAccessToken()` embeds `jti: randomUUID()` and returns `{token, jti}`. `auth-service/src/redis.ts` provides `revokeJti(jti)` (Redis `SET revoked_jtis:<jti> 1 EX 3600`) and `revokeAllForUser(userId)`. APISIX Lua `serverless-post-function` (injected via `setup-apisix.sh`) checks `EXISTS revoked_jtis:<jti>` via `resty.redis` — rejects 401 if found. `POST /auth/revoke` endpoint added in `auth-service/src/index.ts`.

---

### SEC-003 · Write tools need action staging — synchronous loop cannot support them

**Severity:** Critical (architectural — must design before implementing write tools)
**Location:** [[Chat Request Flow]], [[AI Service]] `src/chat.ts` + `src/legacyChat.ts`

**Problem:**
The current agentic loop is fully synchronous: Stage 1 calls tools in a loop until `stop_reason = end_turn`, then Stage 2 synthesizes. There is no mechanism for a mid-loop human approval pause. Adding write tools (reboot device, run script, reset password) to this loop means the LLM can execute destructive operations without user confirmation.

**Remediation — Action Staging State Machine:**

```
Stage 1 (Orchestrator) → encounters write tool call
  ↓
Returns ActionProposal (not execution):
  { action: "reboot-device", args: { deviceUid: "..." }, risk: "high", description: "..." }
  ↓
Session state = PENDING_APPROVAL, stored in chat_sessions
  ↓
SSE stream sends proposal to user UI
  ↓
User sees: "I want to reboot device LAPTOP-001. Confirm?" [Approve] [Reject]
  ↓
POST /api/chat/approve { sessionId, actionId }
  ↓
Bridge executes the staged write tool with the original args
  ↓
Result returned to Stage 2 for synthesis
```

**Required changes:**
- `chat_sessions` needs `pending_action jsonb` + `session_state text` columns (migration)
- New `/api/chat/approve` and `/api/chat/reject` endpoints
- SSE event type `action_proposal` for the UI to render approval cards
- Approval flow must be tied to the original user's session — no cross-session approval
- Write tools must be tagged in `tool_policies` with `approval_required = true`

The existing `approvals` table was designed for this but is not yet wired into the chat flow.

**Status:** Not implemented. Full architectural spec in [[Write Tool State Machine]]. The `approvals` table exists but is disconnected from the agentic loop. Implement from the spec when Phase 1 begins.

---

### SEC-004 · Split read/write MCP containers when write tools arrive

**Severity:** Critical (before write tools are added)
**Location:** [[MCP Server]], [[Datto Credential Isolation]]

**Problem:**
The current isolation guarantee is: "if MCP Server is compromised, attacker gets read-only RMM data." This guarantee disappears the moment write tools share the same container and credentials as read tools. A compromised mcp-read container that can call `reboot-device` is a different threat model entirely.

**Remediation:**
1. Split into `mcp-read` (current container, read-only Datto API key) and `mcp-write` (new container, write-scoped Datto credentials)
2. [[MCP Bridge]] routes tool calls to the appropriate container based on tool name prefix or `tool_policies.is_write`
3. `mcp-write` credentials are scoped to the minimum Datto permissions needed (Datto API supports credential scoping)
4. `mcp-write` only starts if write tools are enabled in config — default off

**Status:** Not implemented. Do before adding any write tools. Blocked until Phase 1.

---

### SEC-005 · Audit log immutability

**Severity:** Critical (before write tools)
**Location:** PostgreSQL `audit_logs` table

**Problem:**
The application DB user has full DML on `audit_logs`. A compromised container can `DELETE` or `UPDATE` audit records — defeating the audit trail for write operations.

**Remediation:**
1. PostgreSQL row-level security: create a separate `audit_writer` role with `INSERT` only on `audit_logs` — no `UPDATE`, `DELETE`, `TRUNCATE`
2. AI Service and Auth Service connect with `audit_writer` for audit inserts, not the superuser
3. For write tool events: dual-write to an append-only sink (PostgreSQL `UNLOGGED` table with RLS + a write-ahead log forwarder, or an external sink like a write-only S3 bucket)
4. Migration: `REVOKE UPDATE, DELETE ON audit_logs FROM app_user; GRANT INSERT ON audit_logs TO app_user;`

**Status:** ✅ Partially implemented — `db/016_audit_log_rls.sql` applies PostgreSQL RLS to `audit_logs` with an INSERT-only policy (SEC-Audit-001). Services still connect as the postgres superuser (items 2–4 above remain for production hardening).

---

## High — Fix before external users

### SEC-006 · Auth endpoint has no rate limiting

**Severity:** High
**Location:** [[API Gateway]] APISIX config, applied via `setup-apisix.sh`

**Problem:**
`POST /api/auth/login` has no rate limit. An attacker can brute-force credentials at full network speed.

**Remediation:**
Add `limit-req` plugin to the `/api/auth/login` route in APISIX:
```yaml
plugins:
  limit-req:
    rate: 5       # 5 requests/second sustained
    burst: 10     # allow brief bursts
    key: remote_addr
    rejected_code: 429
```
Also add `limit-count` for per-IP lockout after N failures within a window.

**Status:** ✅ Implemented — `limit-req` (5 req/s, burst 10, key: remote_addr, 429) applied to the auth route by `setup-apisix.sh` (route 1). Must run `./setup-apisix.sh` after every fresh `docker compose up` to apply.

---

### SEC-007 · `LITELLM_MASTER_KEY` is optional

**Severity:** High
**Location:** `docker-compose.yml`, `.env.example`, [[LiteLLM Gateway]]

**Problem:**
LiteLLM's `/v1` endpoint is open to any process on the internal network when `LITELLM_MASTER_KEY` is unset. A compromised internal container can make arbitrary LLM calls — burning API credits and potentially exfiltrating context via crafted prompts.

**Remediation:**
- `LITELLM_MASTER_KEY` must be set and non-empty. `.env.example` now marks it as required.
- Add a startup check in AI Service: if `LITELLM_URL` is set but `LITELLM_MASTER_KEY` is empty, refuse to start with a clear error message.

**Status:** ✅ Implemented — `ai-service/src/index.ts` `validateEnv()` now exits with a clear error if `LITELLM_URL` is set without `LITELLM_MASTER_KEY`. `ANTHROPIC_API_KEY` removed from required env vars (optional when using LiteLLM).

> **Deploy note:** `LITELLM_MASTER_KEY` must start with `sk-` (e.g. `sk-litellm-admin`). LiteLLM rejects keys that do not match this format with a startup error.

---

### SEC-008 · No forced-revoke path for compromised accounts

**Severity:** High
**Location:** [[Auth Service]], admin panel

**Problem:**
An admin can deactivate a user (`is_active = false`) but their current JWT remains valid until expiry (up to 1h). There is no `force-logout` action.

**Remediation:**
- Dependent on SEC-002 (JTI revocation). Once JTI revocation is implemented, add `POST /api/admin/users/:id/revoke` that writes all of the user's active JTIs to the Redis revocation set.
- Requires tracking issued JTIs per user — add `jti text` column to `refresh_tokens` or a separate `active_jtis` table with TTL management.

**Status:** ✅ Implemented — `POST /api/admin/users/:id/revoke` added to `ai-service/src/index.ts`, proxying to `auth-service/src/handlers.ts` `handleRevoke()`. Auth-service `redis.ts` `revokeAllForUser(userId)` scans `user_jtis:<userId>` sorted set (populated at login via `trackJti()`) and writes all active JTIs to the Redis revocation set. Dependent on SEC-002 — both implemented together.

---

### SEC-009 · Audit logs will capture plaintext credentials when write tools are added

**Severity:** High (before write tools)
**Location:** [[AI Service]] audit logging in `legacyChat.ts` / `chat.ts`

**Problem:**
Tool call arguments are logged verbatim to `audit_logs.details`. When write tools include password reset or credential injection arguments, those values will appear in plaintext in the database.

**Remediation:**
Add a parameter masking layer before audit insert:
- Maintain a registry of sensitive parameter names: `["password", "secret", "credential", "token", "key"]`
- Before logging `toolArgs`, replace values of matching keys with `"[REDACTED]"`
- Apply recursively to nested objects

**Status:** Not implemented. Implement before adding any write tools.

---

## Medium — Important quality/reliability issues

### SEC-010 · PgBouncer missing — PostgreSQL is a single point of failure

**Location:** `docker-compose.yml`, [[PostgreSQL]]

**Problem:**
Every service ([[Auth Service]], [[AI Service]], LiteLLM) connects directly to PostgreSQL. A brief restart or connection saturation kills the entire platform. No connection pooling.

**Remediation:**
- Add PgBouncer as a sidecar (`session` mode — required for `pg_advisory_lock` used by SEC-011 sync locks) between services and PostgreSQL
- Document `max_connections` budget per service
- PgBouncer absorbs reconnect storms during PostgreSQL restarts

**Status:** ✅ Implemented — `pgbouncer` service added to `docker-compose.yml` (`edoburu/pgbouncer:1.23.1`). Config in `services/pgbouncer/pgbouncer.ini` (session mode, max_client_conn=100, default_pool_size=20). `auth-service`, `ai-service`, and `litellm` all route through `pgbouncer:5432`. Session mode is mandatory — transaction mode would break the PostgreSQL advisory locks in `sync.ts` (SEC-011). Note: `DISCARD ALL` server_reset_query safely releases any leaked advisory locks when a client disconnects.

---

### SEC-011 · Sync pipeline has no distributed lock

**Location:** [[AI Service]] `src/sync.ts`

**Problem:**
Two admins clicking "Sync Now" simultaneously launch two parallel sync runs. Both count toward Datto's rate limit (600 req/min). Combined they may hit the limit and trigger a 403 IP block.

**Remediation:**
```typescript
// On sync start:
const lock = await redis.set('sync:lock', '1', 'NX', 'EX', 900); // 15min TTL
if (!lock) return { status: 'already_running' };
// On sync complete/fail:
await redis.del('sync:lock');
```

**Status:** ✅ Implemented — `ai-service/src/sync.ts` uses PostgreSQL advisory locks (`pg_try_advisory_lock`) on both `runSync` and `runAlertSync`. Uses existing `pg` pool — no new dependency.

---

### SEC-012 · Alert cache can be 59 minutes stale without indication

**Location:** [[Local Data Cache]], [[AI Service]] `src/cachedQueries.ts`

**Problem:**
Alerts sync every hour. A device could be offline for 59 minutes before the cache reflects it. For an RMM platform where alerts are time-critical, returning stale alert data without staleness indication is a user trust problem.

**Remediation (pick one):**
1. Move alerts to always-live (remove from cache, always call MCP)
2. Reduce alert sync interval to 5 minutes
3. At minimum: include `[Data from cache — last synced: X minutes ago]` and highlight if staleness > 30 minutes

**Status:** ✅ Implemented — `ai-service/src/cachedQueries.ts` uses `ALERT_CACHED_NOTE()` for all alert functions. Appends staleness age and warns when data is > 30 minutes old. Alerts over 30 min include: `WARNING: alert data is N minutes old — may not reflect current device status.`

---

### SEC-013 · `orchestrator_high_risk` triggers on scope, not execution

**Location:** [[AI Service]] `src/llmConfig.ts`, LiteLLM Gateway

**Problem:**
`orchestrator_high_risk` fires when any high-risk tool is in the user's `allowed_tools` — meaning admin users always run the expensive orchestrator even for simple queries like "how many sites?". `synthesizer_high_risk` fires only when a high-risk tool is actually called. These are inconsistent and wasteful.

**Remediation:**
Make both execution-based: check if a high-risk tool was actually called during the loop, then apply high-risk routing for Stage 2. OR make both scope-based if the intent is "cautious routing for users who have dangerous tools." Document the chosen intent explicitly.

**Status:** ✅ Resolved — ADR-003 decision is **scope-based for orchestrator, execution-based for synthesizer**. Intent is explicitly documented in `ai-service/src/llmConfig.ts` `selectOrchestratorModel()` JSDoc comment. No code change — behaviour is intentional.

---

### SEC-014 · IVFFlat index degrades as `chat_messages` grows

**Location:** [[Chat Messages Table]], `db/007_vector_index.sql`

**Problem:**
IVFFlat requires periodic `VACUUM` and index rebuilds as the table grows. At scale (millions of messages) query quality degrades without maintenance.

**Remediation:**
Switch to HNSW (available in pgvector 0.5+):
```sql
CREATE INDEX chat_messages_embedding_idx ON chat_messages
  USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64);
```
HNSW has no rebuild requirement and better query-time performance at scale. No data migration needed — drop old index, create new.

**Status:** ✅ Implemented — `db/014_hnsw_index.sql`. Run migration to apply: drops old IVFFlat index, creates HNSW with `m=16, ef_construction=64`.

---

### SEC-015 · No context overflow protection in the agentic loop

**Location:** [[AI Service]] `src/legacyChat.ts`, `src/chat.ts`

**Problem:**
Large tool results (full device audit, software list for 300 devices) can push the accumulated Stage 1 context past the model's context limit. There is no token counting or truncation. This causes API errors with no graceful handling.

**Remediation:**
- After each tool result, check `response.usage.input_tokens` against a threshold (e.g. 80% of model context limit)
- If exceeded: summarize accumulated tool results before continuing the loop, or switch to `synthesizer_large_data` immediately

**Status:** ✅ Implemented — `chat.ts` and `legacyChat.ts` break the Stage 1 loop when accumulated message content exceeds 100,000 chars (~25k tokens). Logs `context_overflow_truncation` warn. Stage 2 synthesizes from whatever data was collected.

---

### SEC-016 · Sync failure has no alerting

**Location:** [[AI Service]] `src/sync.ts`, `datto_sync_log`

**Problem:**
If the daily sync fails silently, no one knows until users notice stale data. There is no watchdog, no notification, no health endpoint that surfaces sync age.

**Remediation:**
- Add `/api/admin/sync/health` endpoint: returns `{ status: 'ok' | 'stale' | 'failed', lastSuccess: timestamp, ageMinutes: N }`
- Stale threshold: > 26 hours since last successful `completed` sync row
- Surface staleness warning in the admin data-sync page

**Status:** ✅ Implemented — `GET /api/admin/sync/health` endpoint in `ai-service/src/index.ts`. Returns `{ status: "ok"|"stale"|"never_run", lastSuccess, ageMinutes }`. Stale threshold: 26 hours. Wire to the admin data-sync page UI.

---

## Resolved

| ID | Issue | Fixed in |
|---|---|---|
| SEC-002 | No JWT revocation | `auth-service/src/tokens.ts`, `auth-service/src/redis.ts`, `auth-service/src/handlers.ts`, APISIX Lua injected by `setup-apisix.sh` |
| SEC-006 | Auth endpoint no rate limiting | `setup-apisix.sh` (route 1 `limit-req` plugin) |
| SEC-007 | `LITELLM_MASTER_KEY` optional | `ai-service/src/index.ts` `validateEnv()` |
| SEC-008 | No forced-revoke path | `ai-service/src/index.ts`, `auth-service/src/handlers.ts`, `auth-service/src/redis.ts` |
| SEC-010 | No connection pooling | `docker-compose.yml`, `services/pgbouncer/pgbouncer.ini` |
| SEC-011 | Sync has no distributed lock | `ai-service/src/sync.ts` PostgreSQL advisory locks |
| SEC-012 | Alert cache staleness invisible | `ai-service/src/cachedQueries.ts` `ALERT_CACHED_NOTE()` |
| SEC-013 | Inconsistent high-risk routing | `ai-service/src/llmConfig.ts` JSDoc (ADR-003 resolved) |
| SEC-014 | IVFFlat index degrades at scale | `db/014_hnsw_index.sql` HNSW migration |
| SEC-015 | No context overflow protection | `ai-service/src/chat.ts`, `ai-service/src/legacyChat.ts` |
| SEC-016 | Sync failure has no alerting | `ai-service/src/index.ts` `/api/admin/sync/health` |
| ARCH-002 | Monolithic toolRegistry.ts | `ai-service/src/tools/` domain split (37 tools across 9 files) |
| — | web-app on both Docker networks | docker-compose.yml |
| — | etcd no authentication | docker-compose.yml (documented as accepted risk) |
| — | auth-service/ai-service bound to 0.0.0.0| docker-compose.yml |
| — | Role name inconsistency | README_PLATFORM.md + node files |
| — | JWT expiry conflict (1h vs 24h) | Authentication Flow.md |
| — | synthesizer_large_data threshold conflict | local-llm.md |
| — | datto_cache_users PK conflict | local-data.md |
| — | LiteLLM main-latest mutable tag | docker-compose.yml (→ main-stable + comment) |
| — | LITELLM_MASTER_KEY optional | .env.example |

---

## Related Nodes

[[Network Isolation]] · [[MCP Bridge]] · [[Auth Service]] · [[JWT Model]] · [[RBAC System]] · [[MCP Server]] · [[API Gateway]] · [[PostgreSQL]] · [[Write Tool State Machine]] · [[Datto Credential Isolation]] · [[Chat Messages Table]]

Design history: [[SEC-CACHE-001-PLAN]]
