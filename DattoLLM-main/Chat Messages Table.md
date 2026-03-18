---
tags:
  - platform/database
  - chat
  - vectors
type: Database
description: chat_sessions and chat_messages tables with pgvector HNSW index for cosine similarity semantic search
---

# Chat Messages Table

> Part of the [[Datto RMM AI Platform|claude]] knowledge graph · **Database** node

**Tables:** `chat_sessions` + `chat_messages` in [[PostgreSQL]]

## Schema

```sql
-- chat_sessions
id            uuid PRIMARY KEY DEFAULT uuid_generate_v4()
user_id       uuid REFERENCES users(id) ON DELETE CASCADE
title         text
allowed_tools text[] DEFAULT '{}'   -- tools available at time of session
data_mode     text NOT NULL DEFAULT 'cached'  -- 'cached' | 'live' — toggled via chat UI
created_at    timestamptz DEFAULT now()
updated_at    timestamptz DEFAULT now()

-- chat_messages
id            uuid PRIMARY KEY DEFAULT uuid_generate_v4()
session_id    uuid REFERENCES chat_sessions(id) ON DELETE CASCADE
user_id       uuid REFERENCES users(id) ON DELETE CASCADE
role          text CHECK (role IN ('user','assistant'))
content       text NOT NULL
tools_used    jsonb DEFAULT '[]'    -- tool names called in this turn
token_count   integer
embedding     vector(1024)         -- Voyage-3 embedding for vector search
created_at    timestamptz DEFAULT now()
```

## Vector Index

```sql
-- db/014_hnsw_index.sql (replaces IVFFlat — no training phase, better recall)
CREATE INDEX chat_messages_embedding_hnsw_idx ON chat_messages
  USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64);
```

## Similarity Search Query

```sql
SELECT content, role, tools_used,
       1 - (embedding <=> $1) AS similarity
FROM chat_messages
WHERE user_id = $2
  AND session_id != $3
  AND 1 - (embedding <=> $1) > 0.78
ORDER BY embedding <=> $1
LIMIT 5;
```

Threshold `0.78` = cosine similarity. Requires [[Embedding Service]] (`voyage-3`, 1024 dims).

## Written By

`saveMessages()` in `ai-service/src/history.ts`
- Upserts `chat_sessions` first (avoids FK violation)
- Then inserts user + assistant `chat_messages`

## Read By

- `loadHistory()` — last 20 messages for context window
- `searchSimilar()` — vector nearest-neighbour for semantic memory

## Related Nodes

[[AI Service]] · [[Embedding Service]] · [[Prompt Builder]] · [[Chat Request Flow]] · [[PostgreSQL]]
