CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Core document store
CREATE TABLE IF NOT EXISTS public.documents (
	id BIGSERIAL PRIMARY KEY,
	source TEXT NOT NULL,
	path TEXT,
	metadata JSONB DEFAULT '{}'::jsonb,
	content TEXT NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.documents
	ALTER COLUMN metadata SET DEFAULT '{}'::jsonb,
	ALTER COLUMN created_at SET DEFAULT now();

-- Chunk embeddings table
CREATE TABLE IF NOT EXISTS public.embeddings (
	id BIGSERIAL PRIMARY KEY,
	document_id BIGINT NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
	chunk_index INT NOT NULL,
	chunk_text TEXT NOT NULL,
	embedding vector(1536) NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.embeddings
	ALTER COLUMN created_at SET DEFAULT now();

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'embeddings' AND column_name = 'embedding'
	) THEN
		ALTER TABLE public.embeddings ADD COLUMN embedding vector(1536);
	END IF;
BEGIN
	ALTER TABLE public.embeddings ALTER COLUMN embedding SET NOT NULL;
EXCEPTION WHEN others THEN
	RAISE NOTICE 'Skipped enforcing NOT NULL on embeddings.embedding (existing null data)';
END;
END $$;

-- RAG index table
CREATE TABLE IF NOT EXISTS public.gasable_index (
	node_id TEXT PRIMARY KEY,
	text TEXT,
	embedding vector(1536),
	li_metadata JSONB DEFAULT '{}'::jsonb
);

ALTER TABLE public.gasable_index
	ALTER COLUMN li_metadata SET DEFAULT '{}'::jsonb;

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'gasable_index' AND column_name = 'embedding'
	) THEN
		ALTER TABLE public.gasable_index ADD COLUMN embedding vector(1536);
	END IF;
END $$;

-- Text search index
CREATE INDEX IF NOT EXISTS gasable_index_text_trgm ON public.gasable_index USING gin (text gin_trgm_ops);

ANALYZE public.gasable_index;
ANALYZE public.embeddings;
