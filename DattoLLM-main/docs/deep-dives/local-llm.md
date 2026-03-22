---
tags:
  - deep-dive
  - llm
  - routing
type: Deep Dive
description: Multi-model LLM routing architecture — LiteLLM gateway, Ollama local models, two-stage pipeline, and auto-routing rules
aliases:
  - LLM Routing
  - Model Routing
---

# Local LLM — Multi-Model Routing Architecture

> Parent: [[PLATFORM_BRAIN]] · See also: LLM Routing Setup Guide section in PLATFORM_BRAIN
> Status: **Implemented** — LiteLLM gateway, Ollama local models, two-stage pipeline, routing config table, and admin UI all operational
> Depends on: [[local-data]] (cached Datto data must exist for cached-mode queries)

---

## Architecture Overview

Every chat request runs through a two-stage pipeline (see [[Chat Request Flow]]):

```
User → [[AI Service]] → LiteLLM:4000 → provider API (cloud)
                                      → Ollama:11434 (local)
```

- **Stage 1 (Orchestrator):** selects tools, builds queries — uses a capable but cost-efficient model (Haiku by default, cloud only — local models do not support tool calling)
- **Stage 2 (Synthesizer):** reads tool results, writes prose — routed by data size and risk level. Can use local Ollama models for cached-mode queries.
- Model selection is stored in the `llm_routing_config` DB table ([[PostgreSQL]]) — change via admin panel with no restart needed
- All LLM calls route through LiteLLM (`http://litellm:4000`) which handles provider translation
- Models prefixed with `local/` are routed by LiteLLM to Ollama (`http://ollama:11434`)

---

## Ollama — Local Model Runtime

**What it is:** Docker container (`ollama/ollama:latest`) running on the internal network. Serves local models for synthesis and embeddings with zero cloud cost.

**Docker service:** `ollama` — internal network only, no port exposure. Data persisted in `ollama_data` volume.

**Models:**

| Model | Size | Use | Pull command |
|---|---|---|---|
| `qwen3:1.7b` | ~1.4 GB | Synthesis (Stage 2) | `docker compose exec ollama ollama pull qwen3:1.7b` |
| `nomic-embed-text` | ~0.3 GB | Local embeddings (768 dims) | `docker compose exec ollama ollama pull nomic-embed-text` |

> [!warning] Model choice: why 1.7b not 8b
> Originally tested with `qwen3:8b` (~5.2 GB). On CPU-only Docker (no GPU passthrough), inference took **2+ minutes per response** — unusable. The 1.7b variant runs in **~10–30 seconds on CPU**, which is acceptable for cached-mode synthesis where the data is already local.

**Qwen3 thinking mode:** Qwen3 models default to a "thinking" mode that puts output in `reasoning_content` instead of `content`. The AI service passes `extra_body: { think: false }` via LiteLLM for all local models to disable this and get direct content output. This is handled in `modelRouter.ts`.

**LiteLLM config** (`services/litellm/config.yaml`):

```yaml
- model_name: local/qwen3-1.7b
  litellm_params:
    model: ollama_chat/qwen3:1.7b
    api_base: http://ollama:11434
    supports_function_calling: false
    request_timeout: 60
```

The `local/` prefix is a naming convention — any model name starting with `local/` is routed to Ollama. `supports_function_calling: false` ensures LiteLLM never sends tool schemas to local models.

**Routing flow:**

```
ai-service → LiteLLM:4000 → (model starts with local/) → Ollama:11434
                           → (cloud model)              → OpenRouter → provider API
```

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

**Not suitable:** Local models (no tool calling), DeepSeek R1, Gemini Flash (unreliable tool calling)

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
| `local/qwen3-1.7b` | Cached-mode queries, zero cloud cost | Free (CPU) |

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
        → use local/qwen3-1.7b (Ollama)
        Reason: data is already local, no need for cloud model — zero cost

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
| `synthesizer_cached` | `local/qwen3-1.7b` | When data came from local cache (zero cloud cost) |

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
- Ollama runs on the internal Docker network only — no external access

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
9. ~~Ollama container with qwen3:1.7b and nomic-embed-text~~ ✅ (Docker Compose, internal network)
10. ~~Qwen3 thinking mode disabled via `extra_body: { think: false }`~~ ✅ (`modelRouter.ts`)

---

## Related Nodes

[[AI Service]] · [[Chat Request Flow]] · [[PostgreSQL]] · [[MCP Bridge]] · [[MCP Server]] · [[RBAC System]] · [[Tool Router]] · [[Observability Dashboard]] · [[ROADMAP]] · [[local-data]]
