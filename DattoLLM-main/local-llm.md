# Local LLM — Multi-Model Routing Architecture

> Status: Design only — no code built yet
> Depends on: local-data.md (cached Datto data must exist for cached-mode queries)

---

## Problem With the Current Setup

Every single chat request — even "how many sites do I have?" — goes through this path:

```
User → Claude Opus → Datto API → Claude Opus → Response
```

- One model does everything: tool selection, query building, data reading, response writing
- Every request costs the same regardless of complexity
- No fallback if Claude is down or credits run out
- Switching providers requires code changes

---

## Proposed Architecture

Two changes:

1. **LiteLLM gateway** — sits between the AI service and all LLM providers. One unified API, swap providers in config not code.
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
MCP Bridge → Datto API (live)
  OR
Local PostgreSQL cache (cached mode)
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

The AI service evaluates routing rules in order before making each LLM call.

### Orchestrator routing (Stage 1)

```
Rule 1: Any high-risk tool in the user's allowed_tools list is involved
        → use claude-opus-4-6

Rule 2: Default
        → use claude-haiku-4-5
```

High-risk tools are defined in the `tool_policies` table (`risk_level = 'high'`).

---

### Synthesizer routing (Stage 2)

```
Rule 1: Tool result data size > 2,000 tokens
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
| `synthesizer_large_data` | `deepseek/deepseek-r1` | When tool result exceeds 2,000 tokens |
| `synthesizer_high_risk` | `claude-opus-4-6` | When a high-risk tool was called |
| `synthesizer_cached` | `claude-haiku-4-5` | When data came from local cache |

---

## Provider Keys

Each provider needs an API key. Stored in `.env` and passed to LiteLLM:

| Provider | Key variable | Notes |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | Already exists |
| DeepSeek | `DEEPSEEK_API_KEY` | Required for deepseek/* models |
| Google Gemini | `GEMINI_API_KEY` | Required for gemini/* models |
| OpenAI | `OPENAI_API_KEY` | Optional fallback |

---

## Admin Panel — LLM Config Page

New page at `/admin/llm-config`:

```
Orchestrator (tool selection)
  Default model:       [ claude-haiku-4-5     ▼ ]
  High-risk queries:   [ claude-opus-4-6      ▼ ]

Synthesizer (response writing)
  Default model:       [ claude-haiku-4-5     ▼ ]
  Large data (>2k tok):[ deepseek/deepseek-r1 ▼ ]
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

- The MCP bridge and MCP server are untouched
- The RBAC system and allowed_tools are untouched
- The tool registry is untouched
- The agentic loop logic is the same — only the model names are swapped per stage
- The admin panel gains one new page

---

## Implementation Order

1. Add LiteLLM to `docker-compose.yml`
2. Create `llm_routing_config` table migration
3. Split agentic loop in `legacyChat.ts` and `chat.ts` into two stages
4. Add routing decision logic (reads from `llm_routing_config`)
5. Add admin panel page `/admin/llm-config`
6. Add provider key management to `.env` and LiteLLM config
