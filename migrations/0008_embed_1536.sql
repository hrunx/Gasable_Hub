-- Add 1536-dim embeddings column and vector index for pgvector
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE public.gasable_index
  ADD COLUMN IF NOT EXISTS embedding_1536 vector(1536);

-- HNSW index (1536 is supported)
CREATE INDEX IF NOT EXISTS gasable_idx_1536_hnsw
  ON public.gasable_index USING hnsw (embedding_1536 vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

ANALYZE public.gasable_index;


