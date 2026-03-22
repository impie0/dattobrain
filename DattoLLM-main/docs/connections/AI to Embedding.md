---
type: Connection
from: "[[AI Service]]"
to: "[[Embedding Service]]"
tags:
  - connection
---
# AI Service → Embedding Service

> [!info] Key facts
> **Endpoint:** `POST /embed` | **Port:** 7001 | **Payload:** `{text}` → `{vector: number[], dimensions: 1024}`

Converts user messages to Voyage-3 vectors for semantic memory search. Finds similar past conversations with cosine similarity > 0.78. Vectors are stored in the [[Chat Messages Table]].

**See also:** [[Chat Request Flow]] · [[AI to PostgreSQL]]
