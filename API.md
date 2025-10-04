# Gasable Hub API

This API powers Gasable’s retrieval-augmented generation (RAG) search and ingestion flows on Google Cloud Run.

Base URL
- Cloud Run (example): `https://chart-gasable-hub-3644-zg474t2vda-ew.a.run.app`
- Export a variable for convenience:
```bash
export BASE=https://chart-gasable-hub-3644-zg474t2vda-ew.a.run.app
```

Auth
- Most endpoints are open for GET/POST (public ingress). You can restrict via Cloud Run IAM if desired.
- The MCP invoke endpoint supports a shared token via env `API_TOKEN`.
  - Include `"token": "<API_TOKEN>"` in the JSON body when calling `/api/mcp_invoke`.
- CORS: set `CORS_ORIGINS` (comma-separated) to allow browser apps or leave `*` for testing.

Current production lane
- Embeddings: 1536‑dim, model `text-embedding-3-small`.
- Active column: `public.gasable_index.embedding_1536`.
- Vector ORDER BY uses the operator directly so HNSW index is used.
- LLM reranker enabled before MMR selection to improve top-k quality.

---

## Health and Status
- GET `/health` → liveness
- GET `/api/status` → DB health, pid, active embedding column
- GET `/api/db_stats` → row counts + sample entries + embedding column diagnostics

```bash
curl -s "$BASE/health"
curl -s "$BASE/api/status"
curl -s "$BASE/api/db_stats"
```

## UI
- GET `/` → simple UI
- GET `/dashboard` → DB dashboard

## Query (RAG)
- POST `/api/query`
  - Body: `{ "q": string }`
  - Response: `{ answer, answer_html, trace, context_ids }`
- GET `/api/query_stream?q=...` (SSE)
  - Event sequence: `step` (progress), `final` (JSON with `answer`, `answer_html`, `context_ids`)

```bash
curl -s -X POST "$BASE/api/query" -H 'Content-Type: application/json' -d '{"q":"what is gasable"}'
curl -N "$BASE/api/query_stream?q=what%20is%20gasable"
```

Response fields
- `answer` – structured text with three sections: Problem, Key evidence (bullets), Recommended next steps
- `answer_html` – sanitized HTML for UI
- `trace` – list of steps with timings (useful for debugging latency)
- `context_ids` – array of source ids like `gasable_index:<node_id>`

## Ingestion (FastAPI backend)
- POST `/api/ingest_local` → `{ path }` (server must have access to the path)
- POST `/api/ingest_web` → `{ query, max_results?, allow_domains? }`
- POST `/api/crawl_site` → `{ base, max_pages? }`
- POST `/api/ingest_urls` → `{ urls: string[] }`
- POST `/api/ingest_firecrawl` → `{ base, max_pages? }`
- POST `/api/ingest_drive` → `{ folder_id }`

```bash
curl -s -X POST "$BASE/api/ingest_web" -H 'Content-Type: application/json' -d '{"query":"site:gasable.com","max_results":10}'
```

## DB Introspection
- GET `/api/db/schemas`
- GET `/api/db/tables`
- GET `/api/db/table/{schema}/{table}/columns`
- GET `/api/db/table/{schema}/{table}/count`
- GET `/api/db/table/{schema}/{table}/sample?limit=&offset=`
- GET `/api/processed_files?limit=`
- GET `/api/file_entries?file=&limit=&offset=&full=`

```bash
curl -s "$BASE/api/db/schemas"
curl -s "$BASE/api/db/table/public/gasable_index/columns"
```

## MCP over HTTP (in‑process tools)
- GET `/api/mcp_tools` → list tool specs
- POST `/api/mcp_invoke` → invoke a tool
  - Body: `{ "name": string, "args": object, "token?": string }`
  - Include `token` when `API_TOKEN` is set on Cloud Run.

```bash
curl -s -X POST "$BASE/api/mcp_invoke" -H 'Content-Type: application/json' -d '{
  "name":"db_health",
  "args":{},
  "token":"<API_TOKEN>"
}'
```

---

## Data model (Postgres + pgvector)

Active table (RAG): `public.gasable_index`
```sql
-- Production lane (1536)
CREATE TABLE IF NOT EXISTS public.gasable_index (
  node_id TEXT PRIMARY KEY,
  text TEXT,
  -- legacy column may exist; current writes/read use embedding_1536
  embedding vector(3072),
  embedding_1536 vector(1536),
  li_metadata JSONB DEFAULT '{}'::jsonb,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', COALESCE(text,''))) STORED
);

CREATE INDEX IF NOT EXISTS gasable_idx_1536_hnsw
  ON public.gasable_index USING hnsw (embedding_1536 vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS gasable_index_tsv_idx
  ON public.gasable_index USING gin(tsv);

CREATE INDEX IF NOT EXISTS gasable_index_text_trgm
  ON public.gasable_index USING gin (text gin_trgm_ops);
```

Supporting tables:
```sql
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
```

Which column is used and why
- We standardize on `embedding_1536` (1536-dim) for performance and cost.
- Env `PG_EMBED_COL=embedding_1536` tells the server which vector column to query and write to.
- If legacy 3072 data exists in `embedding`, you can backfill to `embedding_1536` gradually; queries only use the active column.

Useful diagnostics
```sql
-- populated columns
select count(*) filter (where embedding is not null) as emb_3072,
       count(*) filter (where embedding_1536 is not null) as emb_1536
from public.gasable_index;

-- dimensions
select vector_dims(embedding_1536) from public.gasable_index where embedding_1536 is not null limit 1;

-- index-friendly vector search pattern
SELECT node_id, text, 1 - (embedding_1536 <=> $1::vector) AS similarity
FROM public.gasable_index
ORDER BY embedding_1536 <=> $1::vector
LIMIT $2;
```

---

## Environment variables (key ones)
- `DATABASE_URL` (Supabase Postgres; `sslmode=require`)
- `OPENAI_API_KEY`, `OPENAI_MODEL`, `RERANK_MODEL`, `OPENAI_EMBED_MODEL`/`EMBED_MODEL`, `EMBED_DIM`
- `PG_EMBED_COL` (production: `embedding_1536`)
- Retrieval tuning: `RAG_TOP_K`, `RAG_K_DENSE_EACH`, `RAG_K_DENSE_FUSE`, `RAG_K_LEX`, `RAG_KW_PREFILTER_LIMIT`, `RAG_MMR_LAMBDA`, `RAG_BRAND_BOOST_WEIGHT`
- `API_TOKEN` (optional) – shared secret for `/api/mcp_invoke`
- `CORS_ORIGINS` – allowed origins for browser apps (e.g., `https://app.gasable.com, https://intranet.gasable.local`)

Security notes
- Prefer restricting Cloud Run ingress and/or requiring IAM identity tokens for sensitive endpoints.
- When exposing `/api/mcp_invoke`, set `API_TOKEN` and require the `token` in the request body.
- You can harden further by checking `Authorization: Bearer` headers or enabling Cloud Run IAM auth.
