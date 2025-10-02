-- Enable required extensions
create extension if not exists vector;
create extension if not exists pg_trgm;

-- ANN indexes (conditionally create only if dimensions <= 2000). Otherwise, skip safely.
do $$
declare dims int;
begin
  -- gasable_index.embedding
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='gasable_index' and column_name='embedding'
  ) then
    select coalesce((regexp_match(format_type(a.atttypid, a.atttypmod),'vector\((\d+)\)'))[1]::int, 0)
      into dims
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid and c.relname='gasable_index'
    join pg_namespace n on n.oid = c.relnamespace and n.nspname='public'
    where a.attname='embedding';
    if dims > 0 and dims <= 2000 then
      execute 'create index if not exists gasable_index_vec_hnsw on public.gasable_index using hnsw (embedding vector_cosine_ops)';
    else
      raise notice 'Skip ANN index on gasable_index.embedding (dims=%)', dims;
    end if;
  end if;

  -- embeddings.embedding
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='embeddings' and column_name='embedding'
  ) then
    select coalesce((regexp_match(format_type(a.atttypid, a.atttypmod),'vector\((\d+)\)'))[1]::int, 0)
      into dims
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid and c.relname='embeddings'
    join pg_namespace n on n.oid = c.relnamespace and n.nspname='public'
    where a.attname='embedding';
    if dims > 0 and dims <= 2000 then
      execute 'create index if not exists embeddings_vec_hnsw on public.embeddings using hnsw (embedding vector_cosine_ops)';
    else
      raise notice 'Skip ANN index on embeddings.embedding (dims=%)', dims;
    end if;
  end if;
end $$;

-- Trigram GIN indexes for ILIKE prefilters
create index if not exists gasable_index_text_trgm
  on public.gasable_index using gin (text gin_trgm_ops);

create index if not exists documents_content_trgm
  on public.documents using gin (content gin_trgm_ops);

create index if not exists embeddings_chunk_trgm
  on public.embeddings using gin (chunk_text gin_trgm_ops);
