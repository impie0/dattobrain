---
type: Connection
from: "[[AI Service]]"
to: "[[Embedding Service]]"
---
# AI Service → Embedding Service

**Endpoint:** `POST /embed`
**Port:** 7001
**Payload:** `{text}` → `{vector: number[], dimensions: 1024}`

Converts user messages to Voyage-3 vectors for semantic memory search. Finds similar past conversations with cosine similarity > 0.78.
