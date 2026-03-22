-- Stage 7: Semantic Embeddings — pgvector table for all Datto fleet data
-- Model: nomic-embed-text (768 dimensions) running in Ollama
-- Index: HNSW with cosine similarity (best for text embeddings)

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS semantic_embeddings (
  id           BIGSERIAL PRIMARY KEY,
  entity_type  TEXT        NOT NULL,  -- 'device' | 'site' | 'alert' | 'software'
  entity_id    TEXT        NOT NULL,  -- uid or normalized name key
  content_text TEXT        NOT NULL,  -- the plain-text that was embedded
  content_hash TEXT        NOT NULL,  -- MD5 of content_text — skip re-embedding if unchanged
  embedding    vector(768) NOT NULL,
  embedded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_type, entity_id)
);

-- HNSW index for fast cosine similarity search
-- m=16, ef_construction=64 is a good balance of speed vs. recall for ~26K vectors
CREATE INDEX IF NOT EXISTS semantic_embeddings_hnsw_idx
  ON semantic_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- For filtering by entity_type before vector scan
CREATE INDEX IF NOT EXISTS semantic_embeddings_type_idx
  ON semantic_embeddings (entity_type);

-- Monitoring view: how many embeddings per type, when last embedded
CREATE OR REPLACE VIEW semantic_embedding_stats AS
SELECT
  entity_type,
  COUNT(*)            AS embedded_count,
  MAX(embedded_at)    AS last_embedded_at,
  MIN(embedded_at)    AS first_embedded_at
FROM semantic_embeddings
GROUP BY entity_type;
