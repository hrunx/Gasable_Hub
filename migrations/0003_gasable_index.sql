-- LlamaIndex-compatible table for storing embeddings via pgvector
CREATE TABLE IF NOT EXISTS public.gasable_index (
  node_id TEXT PRIMARY KEY,
  text TEXT,
  embedding vector(1536),
  li_metadata JSONB
);

CREATE INDEX IF NOT EXISTS gasable_index_embedding_idx
  ON public.gasable_index USING hnsw (embedding vector_cosine_ops);
