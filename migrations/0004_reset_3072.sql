-- Reset RAG schema to 1536-dim embeddings
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Drop indexes if present
DROP INDEX IF EXISTS gasable_index_embedding_idx;
DROP INDEX IF EXISTS gasable_index_embedding_hnsw;
DROP INDEX IF EXISTS gasable_index_embedding_ivfflat;
DROP INDEX IF EXISTS gasable_index_text_trgm;
DROP INDEX IF EXISTS idx_embeddings_hnsw;
DROP INDEX IF EXISTS idx_embeddings_ivfflat;
DROP INDEX IF EXISTS idx_embeddings_doc_id;

-- Drop tables (order by FKs)
DROP TABLE IF EXISTS public.embeddings;
DROP TABLE IF EXISTS public.documents;
DROP TABLE IF EXISTS public.gasable_index;

-- Recreate tables with 1536-dim vectors
CREATE TABLE public.documents (
    id BIGSERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    path TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    content TEXT NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.embeddings (
    id BIGSERIAL PRIMARY KEY,
    document_id BIGINT NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    chunk_index INT NOT NULL,
    chunk_text TEXT NOT NULL,
    embedding vector(1536) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.gasable_index (
  node_id TEXT PRIMARY KEY,
  text TEXT,
  embedding vector(1536),
  li_metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes
-- Default to IVFFlat for compatibility across providers even though 1536 dims
-- work with HNSW. Tune list count conservatively for small/medium datasets.
CREATE INDEX gasable_index_embedding_ivfflat
  ON public.gasable_index USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_embeddings_ivfflat
  ON public.embeddings USING ivfflat (embedding vector_l2_ops) WITH (lists = 100);
CREATE INDEX gasable_index_text_trgm
  ON public.gasable_index USING gin (text gin_trgm_ops);

ANALYZE public.gasable_index;
ANALYZE public.embeddings;
