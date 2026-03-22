---
tags:
  - planning
  - optimization
type: Planning
description: 8-stage plan — security hardening, token optimization, materialized views, pre-query engine, local LLM, local embeddings
aliases:
  - Optimization Plan
  - 8-Stage Plan
---

# DattoLLM Optimization Plan — 8 Stages

> Recovered from conversation `4dc5c35c` (2026-03-22)

Each stage builds on the previous one. Must be done in order.

---

## Stage 1: Security Hardening (MUST DO FIRST)

Fix all security issues before adding local LLM.

**1a. Fix cross-user session hijack**
- File: `ai-service/src/history.ts` line 8-14
- Add `AND user_id = $2` to loadHistory query
- Add user_id param to all callers

**1b. Fix tool arg parse failure**
- Files: `ai-service/src/legacyChat.ts:251`, `ai-service/src/chat.ts:324`
- On JSON parse failure, return error to LLM instead of empty `{}`
- Empty args on list tools = full data dump = token explosion

**1c. Add user ownership to handleSetDataMode**
- File: `ai-service/src/legacyChat.ts:390`
- Verify session belongs to requesting user before allowing mode change

**1d. Normalize tool denial messages**
- File: `ai-service/src/permissions.ts:22-24`
- Don't echo tool names back to LLM (prevents enumeration via injection)

**1e. Add rate limiting to chat endpoints**
- File: `ai-service/src/index.ts`
- Simple in-memory rate limit: 10 requests/minute per user

---

## Stage 2: Smart Data Truncation (Biggest Token Savings)

Reduce token usage by 96% before adding any new models.

**2a. Tool result size limits**
- Files: `ai-service/src/cachedQueries.ts`, `ai-service/src/legacyChat.ts`, `ai-service/src/chat.ts`
- list-devices: Return top 10 + facets (online/offline counts, OS distribution) + "4091 more, use hostname filter"
- list-open-alerts: Return top 10 by priority + counts per priority + "use site/priority filter"
- get-device-software: Return top 20 + total count + "30 more installed"
- All list results: Max 8,000 chars per tool result

**2b. Block unfiltered list calls**
- If LLM calls list-devices/list-open-alerts with zero filters, return error message instead of data
- "ERROR: List tools require filters. Use hostname, siteName, or priority parameter."

**2c. Strengthen tool descriptions**
- Files: `ai-service/src/tools/*.ts`
- Add "ALWAYS use filters. NEVER call without hostname or siteName." to list tool descriptions

---

## Stage 3: Materialized Views + New Tools

Pre-compute summaries for instant answers.

**3a. Create materialized views**
- New migration: `db/025_materialized_views.sql`
- `mv_fleet_operational_status` — single row, everything at a glance (250 tokens)
- `mv_site_summary` — per-site health metrics (6.8K tokens for all 89 sites)
- `mv_device_health_summary` — per-device summary (6.9K tokens per page of 50)
- `mv_critical_alerts` — top 20 critical/high alerts (1.5K tokens)

**3b. Add new cached tools**
- `get-fleet-status` → mv_fleet_operational_status (replaces 5+ tool calls)
- `list-site-summaries` → mv_site_summary
- `list-critical-alerts` → mv_critical_alerts
- Files: `ai-service/src/cachedQueries.ts`, `ai-service/src/tools/`

**3c. MV refresh in sync**
- File: `ai-service/src/sync.ts`
- After each sync: `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_*`

---

## Stage 4: Smart Pre-Query (Skip LLM for Simple Questions)

Intercept queries before the LLM for instant answers.

**4a. Create pre-query engine**
- New file: `ai-service/src/preQuery.ts`
- Pattern matcher: regex on user input → direct SQL → formatted answer
- 40+ patterns: "how many devices", "fleet overview", "device X health", "patch status", etc.
- MUST check allowedTools before executing (RBAC enforcement)
- MUST audit log all pre-query executions

**4b. Integrate into chat handlers**
- Files: `ai-service/src/legacyChat.ts`, `ai-service/src/chat.ts`
- Before Stage 1: run classifyQuery() → if direct_answer, return immediately (0 LLM tokens)
- If context_injection: pre-fetch data, inject into system prompt, then run LLM with pre-loaded context

**4c. Context injection for complex queries**
- "What's our security posture?" → pre-fetch v_fleet_overview + v_encryption_by_site + v_patch_compliance_by_site → inject as markdown table → LLM synthesizes narrative
- Saves 95% tokens (data already in prompt, no tool calls needed)

---

## Stage 5: Add Ollama (Local LLM Service)

**5a. Add Ollama to Docker**
```yaml
ollama:
  image: ollama/ollama:latest
  volumes:
    - ollama_data:/root/.ollama
  networks:
    - internal
  deploy:
    resources:
      limits:
        memory: 24G
  restart: unless-stopped
```

**5b. Pull models on first start**
- Qwen3 8B: `ollama pull qwen3:8b` (~5GB, tool calling + synthesis)
- nomic-embed-text: `ollama pull nomic-embed-text` (~0.3GB, embeddings)

**5c. Add to LiteLLM config**
```yaml
- model_name: local/qwen3-8b
  litellm_params:
    model: ollama_chat/qwen3:8b
    api_base: http://ollama:11434
    supports_function_calling: true
```

**5d. Security: Ollama on internal network only, no port exposure**

---

## Stage 6: Route to Local LLM

**6a. Update routing config**
```sql
-- Stage 2 (synthesis) → local
UPDATE llm_routing_config SET model = 'local/qwen3-8b' WHERE key = 'synthesizer_default';
UPDATE llm_routing_config SET model = 'local/qwen3-8b' WHERE key = 'synthesizer_cached';
-- Keep orchestrator on Claude (reliable tool calling)
-- Keep high-risk on Claude (accuracy matters)
```

**6b. Add local models to admin UI**
- File: `ai-service/src/admin.ts`
- Add `{ id: "local/qwen3-8b", label: "Qwen3 8B (Local)", provider: "ollama", canOrchestrate: true }`

**6c. Make context overflow threshold configurable per model**
- Local models: 4K-8K context → lower threshold
- Cloud models: 32K-200K → keep current threshold
- File: `ai-service/src/legacyChat.ts:176`

---

## Stage 7: Local Embeddings

**7a. Add Ollama embedding provider**
- File: `embedding-service/src/index.ts`
- New provider: `ollama` → `POST http://ollama:11434/api/embed { model: "nomic-embed-text", input: text }`

**7b. Create semantic_embeddings table**
- New migration: `db/026_semantic_embeddings.sql`
- Single table: entity_type, entity_id, content_text, embedding vector(768)
- Embed devices (4K), alerts (5K), CVEs (10K) — ~17K vectors total

**7c. Resize chat_messages embedding**
- ALTER chat_messages: vector(1024) → vector(768)
- Clear old embeddings (incompatible dimensions)
- New messages get 768-dim embeddings from nomic-embed-text

**7d. Embed data after sync**
- After sync completes: batch-embed changed entities
- Incremental: only re-embed entities where synced_at > embedding updated_at

**7e. Add semantic search tool**
- New tool: `semantic-search` — LLM can search by natural language across devices/alerts/CVEs
- "Find devices running SQL Server" → embeds query → pgvector search → returns matching devices

---

## Stage 8: Full Local Mode (Optional, Future)

**8a. Try Qwen3 8B as orchestrator**
- Test tool calling accuracy on real queries
- If >85% accuracy: switch orchestrator_default to local
- If <85%: keep Claude for orchestration, local for synthesis only

**8b. Remove cloud dependencies**
- Remove OPENROUTER_API_KEY requirement
- Keep as optional fallback for high-risk queries
- 100% local for routine queries, cloud for complex multi-tool chains

---

## Security Checklist (All Stages)

- [x] loadHistory user_id filter (Stage 1)
- [x] Tool arg parse failure → error not empty (Stage 1)
- [x] Session ownership validation (Stage 1)
- [x] Rate limiting on chat (Stage 1)
- [ ] Pre-query respects allowedTools RBAC (Stage 4)
- [ ] Pre-query audit logging (Stage 4)
- [ ] Ollama internal network only (Stage 5)
- [ ] Model allowlist in routing config (Stage 6)
- [ ] Context threshold per model (Stage 6)
- [ ] No new external network access (all stages)

## Token Savings by Stage

| Stage | Avg Tokens/Request | Cumulative Savings |
|---|---|---|
| Current | 150K | — |
| After Stage 2 (truncation) | 12K | 92% |
| After Stage 3 (materialized views) | 5K | 97% |
| After Stage 4 (pre-query) | 2K (many skip LLM entirely) | 99% |
| After Stage 6 (local LLM) | 2K but $0 cost | 99% + free |
| After Stage 7 (local embeddings) | Fully local | 100% cost elimination |

## Critical Files

| File | Stages |
|------|--------|
| `ai-service/src/history.ts` | 1 |
| `ai-service/src/permissions.ts` | 1 |
| `ai-service/src/legacyChat.ts` | 1, 2, 4, 6 |
| `ai-service/src/chat.ts` | 1, 2, 4, 6 |
| `ai-service/src/cachedQueries.ts` | 2, 3 |
| `ai-service/src/tools/*.ts` | 2, 3 |
| `ai-service/src/preQuery.ts` | 4 (new) |
| `ai-service/src/sync.ts` | 3 |
| `db/025_materialized_views.sql` | 3 (new) |
| `db/026_semantic_embeddings.sql` | 7 (new) |
| `docker-compose.yml` | 5 |
| `services/litellm/config.yaml` | 5, 6 |
| `embedding-service/src/index.ts` | 7 |
| `ai-service/src/admin.ts` | 6 |

## Progress (as of 2026-03-22)

Based on uncommitted changes:
- **Stage 1** — DONE (history.ts, permissions.ts, chat.ts, legacyChat.ts, index.ts all modified)
- **Stage 2** — DONE (cachedQueries.ts major expansion, tool descriptions updated)
- **Stage 3** — DONE (025_materialized_views.sql created, fleet.ts tool added, sync.ts updated)
- **Stage 4** — IN PROGRESS (preQuery.ts created at 17KB, chat handlers modified)
- **Stage 5-8** — NOT STARTED
