-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Persisted tsvector for BM25-like ranking
ALTER TABLE public.gasable_index
  ADD COLUMN IF NOT EXISTS tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', COALESCE(text, li_metadata->>'chunk'))
  ) STORED;

-- Indexes
CREATE INDEX IF NOT EXISTS gasable_index_tsv_idx
  ON public.gasable_index USING gin(tsv);

-- Analyze for planner
ANALYZE public.gasable_index;


