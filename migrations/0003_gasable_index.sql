-- LlamaIndex-compatible table for storing embeddings via pgvector
CREATE TABLE IF NOT EXISTS public.gasable_index (
  node_id TEXT PRIMARY KEY,
  text TEXT,
  embedding vector(1536),
  li_metadata JSONB
);

-- Create HNSW index only if vector dims <= 2000 (pgvector HNSW limit)
DO $$
DECLARE dims int;
BEGIN
  SELECT COALESCE((regexp_match(format_type(a.atttypid, a.atttypmod),'vector\((\d+)\)'))[1]::int, 0)
    INTO dims
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid AND c.relname='gasable_index'
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname='public'
  WHERE a.attname='embedding';
  IF dims > 0 AND dims <= 2000 THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS gasable_index_embedding_idx ON public.gasable_index USING hnsw (embedding vector_cosine_ops)';
  ELSE
    RAISE NOTICE 'Skip HNSW on gasable_index.embedding (dims=%); consider IVFFlat', dims;
  END IF;
END $$;
