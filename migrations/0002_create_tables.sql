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
CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw ON public.embeddings USING hnsw (embedding vector_l2_ops);

