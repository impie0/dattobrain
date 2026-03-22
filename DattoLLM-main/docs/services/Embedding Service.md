---
tags:
  - platform/service
  - ai
  - embeddings
aliases:
  - embedding-service
  - embeddings
type: Service
description: Converts text to 1024-dimensional Voyage-3 embedding vectors for semantic memory search
---

# Embedding Service

> Part of the [[Datto RMM AI Platform|PLATFORM_BRAIN]] knowledge graph · **Service** node

**Purpose:** Converts text to embedding vectors. Used by [[AI Service]] for semantic memory search.

> [!info] Service Details
> **Build:** `./embedding-service`
> **Port:** `7001` (internal only)
> **Key env vars:** `EMBEDDING_API_KEY`, `EMBEDDING_PROVIDER` (`voyage` | `openai`), `EMBEDDING_MODEL`

## Endpoint

`POST /embed { text } → { vector: number[], dimensions: number }`

## Providers

| Provider | Model | Dimensions | Notes |
|---|---|---|---|
| `voyage` (default) | `voyage-3` | 1024 | Matches `vector(1024)` in [[Chat Messages Table]] |
| `openai` | `text-embedding-3-small` | 1536 | Requires schema change |

> [!warning] API Key Required
> Requires a real `EMBEDDING_API_KEY` in `.env`. Without it, embeddings silently fail and vector search is disabled.

## Future: Local Embeddings via Ollama

The [[Ollama]] service includes `nomic-embed-text` (768 dimensions, ~0.3 GB). A future stage could route embedding requests to `ollama:11434` for fully local, zero-cost embeddings. This would require a schema migration from `vector(1024)` to `vector(768)` in the [[Chat Messages Table]].

## Connections

- [[connections/AI to Embedding|AI → Embedding]] — `POST /embed` for text-to-vector conversion

## Related Nodes

[[AI Service]] · [[Chat Messages Table]] · [[Chat Request Flow]] · [[Prompt Builder]] · [[PostgreSQL]] · [[Network Isolation]] · [[Ollama]]
