-- Add 1536-dim embeddings column and vector index for pgvector
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE public.gasable_index
  ADD COLUMN IF NOT EXISTS embedding_1536 vector(1536);

-- HNSW index (1536 is supported)
-- Create HNSW index for 1536 dims (<= 2000 supported)
DO $$
BEGIN
  EXECUTE 'CREATE INDEX IF NOT EXISTS gasable_idx_1536_hnsw ON public.gasable_index USING hnsw (embedding_1536 vector_cosine_ops) WITH (m = 16, ef_construction = 64)';
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Skipping HNSW on embedding_1536 due to provider limitation: %', SQLERRM;
END $$;

ANALYZE public.gasable_index;


