---
tags:
  - deep-dive
  - llm
  - routing
type: Deep Dive
description: Multi-model LLM routing architecture — LiteLLM gateway, two-stage pipeline, and auto-routing rules
aliases:
  - LLM Routing
  - Model Routing
---

# Local LLM — Multi-Model Routing Architecture

> Parent: [[PLATFORM_BRAIN]] · See also: LLM Routing Setup Guide section in PLATFORM_BRAIN
> Status: **Implemented** — LiteLLM gateway, two-stage pipeline, routing config table, and admin UI all operational
> Depends on: [[local-data]] (cached Datto data must exist for cached-mode queries)

---

## Architecture Overview

Every chat request runs through a two-stage pipeline (see [[Chat Request Flow]]):

```
User → [[AI Service]] → LiteLLM:4000 → provider API
```

- **Stage 1 (Orchestrator):** selects tools, builds queries — uses a capable but cost-efficient model (Haiku by default)
- **Stage 2 (Synthesizer):** reads tool results, writes prose — routed by data size and risk level
- Model selection is stored in the `llm_routing_config` DB table ([[PostgreSQL]]) — change via admin panel with no restart needed
- All LLM calls route through LiteLLM (`http://litellm:4000`) which handles provider translation

---

## Proposed Architecture

Two changes:

1. **LiteLLM gateway** — sits between the [[AI Service]] and all LLM providers. One unified API, swap providers in config not code.
2. **Two-stage pipeline** — split the agentic loop into an orchestrator stage (tool calling) and a synthesizer stage (response writing). Different models can handle each stage.

```
User question
      ↓
AI Service
      ↓
┌─────────────────────────────┐
│  Stage 1: Orchestrator      │  ← picks tools, builds queries
│  Model: configurable        │  ← must support tool calling
└─────────────────────────────┘
      ↓ tool selected
[[MCP Bridge]] → Datto API (live)
  OR
Local [[PostgreSQL]] cache (cached mode)
      ↓ data returned
┌─────────────────────────────┐
│  Stage 2: Synthesizer       │  ← reads data, writes response
│  Model: configurable        │  ← any model, no tool calling needed
└─────────────────────────────┘
      ↓
Response to user
```

---

## LiteLLM Gateway

**What it is:** Open source Docker container. Provides one OpenAI-compatible API endpoint that routes to any provider.

**Why it's needed:**
- Claude, Gemini, DeepSeek, OpenAI all have different API formats
- Without it, switching providers means rewriting API calls
- With it, changing the model is a config value, not a code change

**Docker service:** `litellm` — added to `docker-compose.yml`, internal network only

**How the AI service uses it:**

```
Current:  ai-service → api.anthropic.com (direct)
Proposed: ai-service → litellm:4000 → api.anthropic.com / generativelanguage.googleapis.com / api.deepseek.com
```

The AI service sends every LLM call to `http://litellm:4000` with a model name like `claude-opus-4-6` or `deepseek/deepseek-r1`. LiteLLM handles authentication and routing to the correct provider.

---

## Two-Stage Pipeline Detail

### Stage 1 — Orchestrator

**Job:** Read the user's question and decide which tool to call with which arguments.

**Requirements:**
- Must support tool calling / function calling
- Must be reliable and accurate with tool schemas
- Does NOT need to write good prose

**Suitable models:**
| Model | Good for | Cost |
|---|---|---|
| `claude-haiku-4-5` | Default orchestration | Low |
| `claude-opus-4-6` | Complex multi-step queries | High |
| `gpt-4o` | Alternative if Claude unavailable | Medium |

**Not suitable:** DeepSeek R1, Gemini Flash (unreliable tool calling)

---

### Stage 2 — Synthesizer

**Job:** Take the raw data returned from Datto (or the local cache) and write a clear, accurate response.

**Requirements:**
- No tool calling needed
- Must handle large amounts of text/JSON well
- Needs to write good, structured responses

**Suitable models:**
| Model | Good for | Cost |
|---|---|---|
| `claude-haiku-4-5` | Simple lookups, short answers | Low |
| `deepseek/deepseek-r1` | Large data summarisation, reports | Very low |
| `claude-opus-4-6` | Complex analysis, sensitive operations | High |
| `gemini/gemini-2.0-flash` | Fast large-context processing | Low |

---

## Auto-Routing Rules

> [!info] Routing logic
> The [[AI Service]] evaluates routing rules in order before making each LLM call. Orchestrator uses **scope-based** routing (checks `allowed_tools`), while synthesizer uses **execution-based** routing (checks what was actually called). See [[SECURITY_FINDINGS|SEC-013]] / ADR-003 for the rationale.

### Orchestrator routing (Stage 1)

```
Rule 1: Any high-risk tool in the user's allowed_tools list is involved
        → use claude-opus-4-6

Rule 2: Default
        → use claude-haiku-4-5
```

High-risk tools are defined in the `tool_policies` table (`risk_level = 'high'`) in [[PostgreSQL]].

---

### Synthesizer routing (Stage 2)

> [!tip] Model selection is execution-based for synthesizer
> Unlike the orchestrator, the synthesizer checks what tools were **actually called**, not what the user has access to. This avoids paying for expensive models on simple queries from admin users.

```
Rule 1: Tool result data size > 8,000 chars
        → use deepseek/deepseek-r1
        Reason: cheap at large context, good at summarisation

Rule 2: A high-risk tool was called during this request
        → use claude-opus-4-6
        Reason: careful, accurate response for sensitive operations

Rule 3: Cached mode query (data came from local DB, no live Datto call)
        → use claude-haiku-4-5
        Reason: simple structured data, no need for large model

Rule 4: Default
        → use claude-haiku-4-5
```

---

## Routing Config Table (DB)

Stored in `llm_routing_config` table. Editable from the admin panel — no rebuild needed.

```sql
CREATE TABLE llm_routing_config (
  key   text PRIMARY KEY,  -- e.g. 'orchestrator_default', 'synthesizer_large_data'
  model text NOT NULL,     -- e.g. 'claude-haiku-4-5', 'deepseek/deepseek-r1'
  description text
);
```

**Default rows:**

| key | model | description |
|---|---|---|
| `orchestrator_default` | `claude-haiku-4-5` | Default tool selection model |
| `orchestrator_high_risk` | `claude-opus-4-6` | Used when high-risk tools are in scope |
| `synthesizer_default` | `claude-haiku-4-5` | Default response generation |
| `synthesizer_large_data` | `deepseek/deepseek-r1` | When tool result exceeds 8,000 chars |
| `synthesizer_high_risk` | `claude-opus-4-6` | When a high-risk tool was called |
| `synthesizer_cached` | `claude-haiku-4-5` | When data came from local cache |

---

## Provider Keys

All LLM routing goes through OpenRouter by default. Stored in `.env` and passed to LiteLLM:

| Provider | Key variable | Notes |
|---|---|---|
| OpenRouter | `OPENROUTER_API_KEY` | **Primary** — routes Claude, DeepSeek, Gemini through one key |
| Anthropic | `ANTHROPIC_API_KEY` | Only needed for direct-Anthropic routes in LiteLLM config (not default) |
| DeepSeek | `DEEPSEEK_API_KEY` | Only needed if routing DeepSeek directly (not via OpenRouter) |
| Google Gemini | `GEMINI_API_KEY` | Only needed if routing Gemini directly (not via OpenRouter) |

`LITELLM_MASTER_KEY` must be set and must start with `sk-` (e.g. `sk-litellm-admin`). LiteLLM rejects keys that do not match this format. All ai-service requests automatically use this key via `llmClient`.

---

## Admin Panel — LLM Config Page

New page at `/admin/llm-config`:

```
Orchestrator (tool selection)
  Default model:       [ claude-haiku-4-5     ▼ ]
  High-risk queries:   [ claude-opus-4-6      ▼ ]

Synthesizer (response writing)
  Default model:       [ claude-haiku-4-5     ▼ ]
  Large data (>8k chr):[ deepseek/deepseek-r1 ▼ ]
  High-risk tool used: [ claude-opus-4-6      ▼ ]
  Cached mode queries: [ claude-haiku-4-5     ▼ ]

Provider Keys
  Anthropic API key:   [ ●●●●●●●●●●●●●●●● ]  ← masked
  DeepSeek API key:    [ not configured    ]
  Gemini API key:      [ not configured    ]

[ Save ]
```

---

## Fallback Behaviour

If the selected model fails (provider down, credits exhausted):

1. LiteLLM returns an error
2. AI service catches it
3. Falls back to `claude-haiku-4-5` as the default
4. If that also fails — returns the billing/provider error message to the user (same as current behaviour)

Fallback chain is configurable in LiteLLM config.

---

## What Does NOT Change

- The [[MCP Bridge]] and [[MCP Server]] are untouched
- The [[RBAC System]] and allowed_tools are untouched
- The [[Tool Router]] and tool registry are untouched
- The agentic loop logic is the same — only the model names are swapped per stage
- The [[Web App]] admin panel gains one new page

---

## Implementation Status

All items below are complete:

1. ~~Add LiteLLM to `docker-compose.yml`~~ ✅ (`ghcr.io/berriai/litellm:v1.82.3-stable`, port 4000)
2. ~~Create `llm_routing_config` table migration~~ ✅ (`db/012_llm_routing_config.sql`)
3. ~~Split agentic loop in `legacyChat.ts` and `chat.ts` into two stages~~ ✅
4. ~~Add routing decision logic (reads from `llm_routing_config`)~~ ✅ (`ai-service/src/llmConfig.ts`)
5. ~~Add admin panel page `/admin/llm-config`~~ ✅
6. ~~Add provider key management to `.env` and LiteLLM config~~ ✅ (OpenRouter primary)
7. ~~SEC-Routing-001: scope-based high-risk routing for both stages~~ ✅
8. ~~LLM request logs with model columns~~ ✅ (`db/013_llm_logs_models.sql`)

---

## Related Nodes

[[AI Service]] · [[Chat Request Flow]] · [[PostgreSQL]] · [[MCP Bridge]] · [[MCP Server]] · [[RBAC System]] · [[Tool Router]] · [[Observability Dashboard]] · [[ROADMAP]] · [[local-data]]
