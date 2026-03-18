-- SEC-014: Migrate chat_messages vector index from IVFFlat to HNSW.
--
-- IVFFlat degrades as the table grows — query quality drops without periodic
-- VACUUM + manual index rebuilds. HNSW (pgvector 0.5+) has no rebuild requirement
-- and provides better query-time performance at scale. No data migration needed.
--
-- Parameters (conservative defaults — tune after benchmarking on real data):
--   m=16             neighbours per node (higher = better recall, more memory)
--   ef_construction=64  build-time beam width (higher = better index quality, slower build)

DROP INDEX IF EXISTS chat_messages_embedding_idx;

CREATE INDEX chat_messages_embedding_idx ON chat_messages
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
