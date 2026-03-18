CREATE INDEX IF NOT EXISTS chat_messages_embedding_idx
  ON chat_messages
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
