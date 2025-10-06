-- Core doc store and embeddings for RAG
CREATE TABLE IF NOT EXISTS public.documents (
	id BIGSERIAL PRIMARY KEY,
	source TEXT NOT NULL,
	path TEXT,
	metadata JSONB DEFAULT '{}'::jsonb,
	content TEXT NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.embeddings (
	id BIGSERIAL PRIMARY KEY,
	document_id BIGINT NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
	chunk_index INT NOT NULL,
	chunk_text TEXT NOT NULL,
	embedding vector(1536) NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_embeddings_doc_id ON public.embeddings(document_id);
-- Create HNSW index only when dims <= 2000
DO $$
DECLARE dims int;
BEGIN
  SELECT COALESCE((regexp_match(format_type(a.atttypid, a.atttypmod),'vector\((\d+)\)'))[1]::int, 0)
    INTO dims
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid AND c.relname='embeddings'
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname='public'
  WHERE a.attname='embedding';
  IF dims > 0 AND dims <= 2000 THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw ON public.embeddings USING hnsw (embedding vector_l2_ops)';
  ELSE
    RAISE NOTICE 'Skip HNSW on embeddings.embedding (dims=%); consider IVFFlat', dims;
  END IF;
END $$;

