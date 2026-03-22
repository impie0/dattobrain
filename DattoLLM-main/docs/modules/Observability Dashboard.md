---
tags:
  - platform/feature
  - admin
  - observability
type: Feature
aliases:
  - Observability
  - Admin Dashboard
  - Monitoring
description: Admin-only dashboard for monitoring system health, LLM usage, tool call patterns, and cache freshness
---

# Observability Dashboard

> Part of the [[Datto RMM AI Platform|PLATFORM_BRAIN]] knowledge graph · **Feature** node

**Purpose:** Admin-only dashboard for monitoring system health, LLM usage, tool call patterns, MCP status, chat activity, and cache freshness. Auto-refreshes every 10 seconds via polling. No new dependencies — charts are inline SVG.

**Backend:** `ai-service/src/observability.ts`
**Migration:** `db/014_observability.sql` (10 performance indexes for time-windowed aggregations)

## Routes

All routes use `adminOnly` middleware (enforced by [[RBAC System]]).

| Route | Handler | Returns |
|---|---|---|
| `GET /api/admin/observability/overview` | `handleObsOverview` | Request/tool/error counts (5m/1h/24h), active sessions, tokens, cache mode, 24h time-series |
| `GET /api/admin/observability/llm` | `handleObsLlm` | Per-stage token breakdown (orch vs synth), per-provider split (cloud vs ollama), last 100 LLM requests with clickable detail rows |
| `GET /api/admin/observability/tools` | `handleObsTools` | Top 20 tools with error rates, call time-series, last 100 tool events |
| `GET /api/admin/observability/mcp` | `handleObsMcp` | Bridge health probe, error/denied stats, top denied tools, recent errors |
| `GET /api/admin/observability/chat` | `handleObsChat` | Session/message counts, message volume time-series, active sessions list |
| `GET /api/admin/observability/cache` | `handleObsCache` | Last 20 sync runs, cache table record counts, cached/live distribution |

**Frontend pages:** `/admin/observability/` subtree (see [[Web App]] pages table)

## LLM Page Design

The LLM observability page provides per-stage token visibility:

- **Summary cards** — separate token counts for orchestrator stage (prompt/completion) and synthesizer stage (prompt/completion), broken down by provider (`cloud` vs `ollama`)
- **Token time-series** — hourly buckets split by orchestrator vs synthesizer
- **Request table** — last 100 LLM requests with clickable rows; each row expands into a detail panel with three tabs:
  - **Messages** — full conversation messages for the request
  - **Tools** — tool calls made during the request with results
  - **System** — system prompt, model selection, data mode, timing metadata
- **Provider split** — queries aggregate by `orchestrator_provider` and `synth_provider` columns in `llm_request_logs`
- Token columns: `orch_prompt_tokens`, `orch_completion_tokens`, `orch_total_tokens`, `synth_prompt_tokens`, `synth_completion_tokens`, `synth_total_tokens`

## General Design

- All queries use `Promise.all` for parallel execution
- Time-series buckets use `DATE_TRUNC('hour', created_at)` for 24h views
- Overview page shows 6 stat cards with sparklines + 5 clickable drill-down cards
- Each sub-page: breadcrumb nav, summary cards, SVG charts, data table
- No heavy scans — all queries hit dedicated `obs_*` indexes from migration 014 (in [[PostgreSQL]])
- Data sourced from existing tables: `audit_logs`, `llm_request_logs`, [[Chat Messages Table|chat_messages]], `chat_sessions`, `datto_sync_log`, `datto_cache_*`

## Related Nodes

[[AI Service]] · [[Web App]] · [[RBAC System]] · [[Local Data Cache]] · [[PostgreSQL]] · [[API Gateway]] · [[MCP Bridge]] · [[Chat Messages Table]] · [[Data Explorer]]
