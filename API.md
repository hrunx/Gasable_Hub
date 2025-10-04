# Gasable Hub API

Base URL
- Cloud Run: `https://chart-gasable-hub-3644-593853561959.europe-west1.run.app`

Auth
- Most endpoints are open as per Cloud Run ingress (you can restrict via Cloud Run IAM).
- MCP invoke endpoint supports an optional shared token via env `API_TOKEN`.
  - Include `"token": "<API_TOKEN>"` in the JSON body when set.

Example API token (set in Cloud Run → Variables as API_TOKEN)
- Value (example): `API_TOKEN=ak_gasablehub-pq7X-55-L0hrn4da2goat0-hehe-3MZ`
 

---

## Health and Status
- GET `/health` → liveness
- GET `/api/status` → DB health, pid, active embedding column
- GET `/api/db_stats` → row counts + sample entries

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
- GET `/api/query_stream?q=...` (SSE)

```bash
curl -s -X POST "$BASE/api/query" -H 'Content-Type: application/json' -d '{"q":"what is gasable"}'
curl -N "$BASE/api/query_stream?q=what%20is%20gasable"
```

## Ingestion (FastAPI backend)
- POST `/api/ingest_local` → `{ path }`
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

## MCP over HTTP (in-process)
- GET `/api/mcp_tools` → list tool specs
- POST `/api/mcp_invoke` → invoke a tool in-process
  - Body: `{ "name": string, "args": object, "token?": string }`
  - When `API_TOKEN` is set on Cloud Run, include `token` with the same value.

```bash
# List tools
curl -s "$BASE/api/mcp_tools"

# Invoke db_health (with API_TOKEN if set)
curl -s -X POST "$BASE/api/mcp_invoke" -H 'Content-Type: application/json' -d '{
  "name":"db_health",
  "args":{},
  "token":"ak_gasablehub-pq7X-55-L0hrn4da2goat0-hehe-3MZ"
}'

# Ingest web via tool
curl -s -X POST "$BASE/api/mcp_invoke" -H 'Content-Type: application/json' -d '{
  "name":"ingest_web",
  "args":{"query":"site:gasable.com","max_results":10,"allow_domains_csv":"gasable.com"},
  "token":"ak_gasablehub-pq7X-55-L0hrn4da2goat0-hehe-3MZ"
}'
```

## Environment variables (key ones)
- `DATABASE_URL` (Supabase Postgres; sslmode=require)
- `OPENAI_API_KEY`, `OPENAI_MODEL`, `EMBED_MODEL`, `EMBED_DIM`
- `PG_EMBED_COL` (e.g., `embedding`)
- Retrieval tuning: `RAG_TOP_K`, `RAG_K_DENSE_EACH`, `RAG_K_DENSE_FUSE`, `RAG_K_LEX`, `RAG_KW_PREFILTER_LIMIT`, `RAG_MMR_LAMBDA`, `RAG_BRAND_BOOST_WEIGHT`
- `API_TOKEN` (optional) – shared secret for `/api/mcp_invoke`

---

Security notes
- Prefer restricting Cloud Run ingress and/or requiring IAM identity tokens.
- For `/api/mcp_invoke`, set `API_TOKEN` and include it in request body.
- For stricter security, extend to validate `Authorization: Bearer <token>` headers.
