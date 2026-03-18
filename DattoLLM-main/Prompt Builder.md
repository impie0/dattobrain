---
tags:
  - platform/module
  - ai
  - llm
type: Module
description: Constructs the LLM system prompt from platform instructions, filtered tool definitions, and semantically similar past messages
---

# Prompt Builder

> Part of the [[Datto RMM AI Platform|claude]] knowledge graph · **Module** node

**Purpose:** Constructs the LLM system prompt from three blocks: platform instructions, filtered tool definitions, and semantically similar past messages.

**File:** `ai-service/src/prompt.ts`

**Exported functions:**
- `buildSystemPrompt(allowedToolDefs, similarMessages): string` — Stage 1 orchestrator system prompt
- `buildSynthesizerPrompt(): string` — Stage 2 synthesizer system prompt

## Prompt Structure

```
1. Platform instructions
   — You are a Datto RMM assistant
   — Only use the tools provided
   — Be concise and accurate

2. Tool definitions block
   — JSON array of ONLY allowed tool schemas
   — Tools not in allowed_tools are never mentioned

3. Similar past messages block (from vector search)
   — Up to 5 semantically similar prior exchanges
   — Provides RMM-domain context without full history replay
```

## Layer 1 Security Role

By only injecting tool definitions for tools in `allowed_tools`, the model is prevented from even knowing other tools exist. Even if a user prompts "use the delete-device tool", the model has no schema for it.

**`buildSystemPrompt` called by:** `legacyChat.ts:handleLegacyChat` · `chat.ts:handleChat` (Stage 1 orchestrator prompt)
**`buildSynthesizerPrompt` called by:** `legacyChat.ts` · `chat.ts` (Stage 2 synthesizer prompt)
**Receives:** Filtered tool defs from [[Tool Router]], similar messages from [[Embedding Service]] / pgvector

## Related Nodes

[[Tool Router]] · [[RBAC System]] · [[Chat Request Flow]] · [[Embedding Service]] · [[AI Service]]
