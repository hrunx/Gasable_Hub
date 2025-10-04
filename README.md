# Gasable Hub – RAG API and Ingestion (Google Cloud Run)

### What this hub does (for business)
- **All your energy intelligence in one place**: We collected Gasable’s documents (PDF/DOCX/TXT), key web pages, and research, then indexed them into a searchable knowledge base.
- **Understands Arabic + English**: High‑quality PDF extraction (Arabic included) with OCR fallback for scans.
- **Answers like a consultant**: The chatbot retrieves the most relevant evidence and answers with a clear structure: customer needs, supporting facts, and recommended next steps.
- **Works from anywhere**: A Cloud Run API (and optional static UI) lets you use the hub from the web and integrate it into internal tools.

In short: it’s a robust, bilingual knowledge hub that helps you find facts fast, justify decisions, and move to action.

## Quick Start (local)

- Requirements: Python 3.11+, PostgreSQL 14+ with `pgvector`, optional Docker for Firecrawl OS.
- Install deps:
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```
- Database: enable pgvector and table (if not already present). We standardize on 1536‑dim embeddings in `embedding_1536`.
```sql
-- in psql connected to your DB
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS public.gasable_index (
  node_id TEXT PRIMARY KEY,
  text TEXT,
  embedding vector(3072), -- legacy column may exist
  embedding_1536 vector(1536), -- production lane
  li_metadata JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS gasable_idx_1536_hnsw
  ON public.gasable_index USING hnsw (embedding_1536 vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS gasable_index_tsv_idx ON public.gasable_index USING gin(tsv);
```
- Configure environment (copy and edit):
```bash
# if you have an example file
# cp .env.example .env
# otherwise create .env with the variables below
```
Key environment variables:
- `OPENAI_API_KEY`: for embeddings and answers
- `OPENAI_EMBED_MODEL` (production `text-embedding-3-small`)
- `OPENAI_MODEL` (default `gpt-5-mini`)
- `PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASSWORD`, `PG_DBNAME`
- `PG_EMBED_COL` (production: `embedding_1536`)
- `CORS_ORIGINS` (comma-separated list or `*`)
- `CHUNK_CHARS` (default 4000)
- RAG tuning: `RAG_TOP_K` (6), `RAG_K_DENSE_EACH` (8), `RAG_K_DENSE_FUSE` (10), `RAG_K_LEX` (12), `RAG_CORPUS_LIMIT` (1200), `RAG_MMR_LAMBDA` (0.7)
- Firecrawl (optional): `FIRECRAWL_BASE_URL` (e.g., `http://127.0.0.1:3002`)

- Run API (dev):
```bash
source .venv/bin/activate
uvicorn webapp:app --host 127.0.0.1 --port 8000 --reload
```
- Expose API on your server (production, bind publicly):
```bash
# gunicorn with uvicorn workers
source .venv/bin/activate
gunicorn -k uvicorn.workers.UvicornWorker webapp:app \
  --bind 0.0.0.0:8000 --workers 2 --timeout 120
```
Behind a reverse proxy (recommended):
```nginx
server {
  listen 80;
  server_name api.yourdomain.com;
  location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
  }
}
```
Enable TLS via your proxy (e.g., Certbot/Let’s Encrypt).

### Docker (local) and Google Cloud Run

Build and run locally:
```bash
docker build -t gasable-hub:local .
docker run --rm -p 8080:8080 \
  -e OPENAI_API_KEY=$OPENAI_API_KEY \
  -e DATABASE_URL=$DATABASE_URL \
  -e CORS_ORIGINS="*" \
  gasable-hub:local
# Open http://localhost:8080
```

Deploy to Cloud Run (replace <PROJECT_ID> and region):
```bash
gcloud auth login
gcloud config set project <PROJECT_ID>

# Build & push image via Cloud Build
gcloud builds submit --tag gcr.io/<PROJECT_ID>/gasable-hub .

# Deploy to Cloud Run
gcloud run deploy gasable-hub \
  --image gcr.io/<PROJECT_ID>/gasable-hub \
  --platform managed \
  --region europe-west1 \
  --allow-unauthenticated \
  --port 8080 \
  --memory 1Gi \
  --cpu 1 \
  --max-instances 10 \
  --concurrency 80

# Set env vars (example – production lane 1536)
gcloud run services update gasable-hub \
  --region europe-west1 \
  --set-env-vars OPENAI_API_KEY=__SET_IN_CONSOLE__,DATABASE_URL=__SET_IN_CONSOLE__,CORS_ORIGINS=*,PG_EMBED_COL=embedding_1536,EMBED_DIM=1536,OPENAI_EMBED_MODEL=text-embedding-3-small
```

Secrets to add (Cloud Run → Variables & Secrets):
- `OPENAI_API_KEY`
- `DATABASE_URL` (Postgres with pgvector)
- Optional: `GCS_BUCKET_NAME`, `GDRIVE_FOLDER_ID`, `OPENAI_MODEL`, `OPENAI_EMBED_MODEL`

Service account: grant minimum IAM needed (Cloud Run Invoker, Storage access if using GCS). Prefer attaching the runtime service account rather than bundling JSON keys.

### MCP (Model Context Protocol)

There are two ways to use tools:

- Native MCP server (stdio): run a local process your MCP client can spawn.
- HTTP compatibility (Cloud Run): discover tools and invoke via REST for browser integrations.

Native MCP (stdio)

Run the MCP server locally:
```bash
python -m gasable_hub.server
```
The server exposes tools registered under `gasable_hub.tools.*`. Configure your MCP client to spawn the command above and pass env vars for DB and OpenAI keys.

Example client config (pseudo‑JSON):
```json
{
  "name": "gasable-hub",
  "command": "/usr/bin/python3",
  "args": ["-m", "gasable_hub.server"],
  "env": {
    "DATABASE_URL": "postgresql://.../postgres?sslmode=require",
    "OPENAI_API_KEY": "<secret>",
    "OPENAI_MODEL": "gpt-5-mini",
    "EMBED_MODEL": "text-embedding-3-small",
    "EMBED_DIM": "1536",
    "PG_EMBED_COL": "embedding_1536"
  },
  "cwd": "/path/to/repo"
}
```

Node (spawn stdio MCP):
```ts
import { StdioClient } from "@modelcontextprotocol/sdk/client/stdio";

const client = await StdioClient.create({
  command: "python3",
  args: ["-m", "gasable_hub.server"],
  env: { DATABASE_URL: process.env.DATABASE_URL!, OPENAI_API_KEY: process.env.OPENAI_API_KEY! },
});

const tools = await client.listTools();
const result = await client.callTool({ name: "ingest_web", arguments: { query: "site:gasable.com", max_results: 5 } });
console.log(result);
```

HTTP compatibility (Cloud Run)

- `GET  /api/mcp_tools` → discover tool specs (for UIs)
- `POST /api/mcp_invoke` → `{ name, args, token }` (set `API_TOKEN` to require a shared secret)

### Serverless (Netlify Functions, TypeScript) – pgvector RAG API
- Endpoints:
  - `POST /.netlify/functions/query` – vector search (OpenAI embeddings → pgvector) with optional concise LLM answer.
  - `GET  /.netlify/functions/query_stream?q=...` – streaming hybrid RAG over SSE.
  - `POST /api/query` – fast lexical BM25 answer via `functions/api.js`.
- Behavior highlights:
  - Answers are formatted in Markdown with concise bullets; sanitization removes noisy HTML/MD artifacts.
  - Some small models only support default temperature; we omit `temperature` in Functions to avoid model errors.
  - Streaming uses up to 8 diverse context chunks and boosts `gasable.com` when present.
  - For vector search, `k` can be passed in the JSON body (default 12).

#### cURL examples
```bash
# Lexical (sanitized)
curl -s -X POST https://<site>.netlify.app/api/query -H 'Content-Type: application/json' -d '{"q":"What are Gasable services?"}'

# Vector + LLM (single-shot)
curl -s -X POST https://<site>.netlify.app/.netlify/functions/query -H 'Content-Type: application/json' -d '{"q":"What are Gasable services?","k":12,"withAnswer":true}'

# Streaming hybrid (SSE)
curl -N "https://<site>.netlify.app/.netlify/functions/query_stream?q=What%20are%20Gasable%20services"
```

---

## Configuration: Retrieval and RAG Settings

This project exposes several knobs via environment variables. Defaults are chosen for quality/latency balance.

### Global/OpenAI
- `OPENAI_API_KEY` – required for embeddings and LLM answers
- `OPENAI_EMBED_MODEL` / `EMBED_MODEL` – default `text-embedding-3-small` (1536)
- `OPENAI_MODEL` / `RERANK_MODEL` – default `gpt-5-mini` (you can use `gpt-4o-mini`)

### Database (Postgres + pgvector)
- `DATABASE_URL` (or `SUPABASE_DB_URL`) – pooled URL with SSL
- `PG_SCHEMA` – default `public`
- `PG_TABLE` – default `gasable_index`
- `EMBED_DIM` – default `1536` (must match the dimension used at ingestion)

### FastAPI (full backend) – Retrieval knobs
- `RAG_TOP_K` – final context chunks to answer with (default 6)
- `RAG_K_DENSE_EACH` – vector hits per table before fusion (default 8)
- `RAG_K_DENSE_FUSE` – cap fused dense candidates (default 10)
- `RAG_K_LEX` – Lexical SQL FTS candidates per expansion (default 12)
- `RAG_CORPUS_LIMIT` – (legacy) rows per table used to build BM25 cache (unused in FTS path)
- `RAG_MMR_LAMBDA` – diversity vs relevance tradeoff (default 0.7)
- `RAG_EXPANSIONS` – max generated query expansions (default 2)
- `RAG_BM25_TTL_SEC` – BM25 cache TTL seconds (default 300)

### Netlify Functions – Retrieval knobs
- Vector single-shot (`functions/query.ts`):
  - Request body: `{ q: string, k?: number, withAnswer?: boolean }` (k defaults to 12)
  - Env: `EMBED_MODEL`, `EMBED_DIM`, `PG_SCHEMA`, `PG_TABLE`, `OPENAI_MODEL`/`RERANK_MODEL`
- Streaming hybrid (`functions/query_stream.ts`):
  - SSE endpoint. Internally selects up to 8 context chunks (constant). Prioritizes `gasable.com` when available.
  - Env: same as vector (embeddings + DB). No temperature passed (model default).

### Ingestion / Indexing
- `CHUNK_CHARS` – chunk size for ingestion (default 4000)
- Use CLI or FastAPI ingestion endpoints; Netlify Functions are not used for long-running ingestion.

---

## Ingestion

### Local files (PDF, DOCX, TXT)
CLI:
```bash
python -m gasable_hub.tools.ingest_local \
  --path "/absolute/path/to/your/folder_or_file" \
  --chunk-chars 3500 \
  --embed-model text-embedding-3-small \
  --log-file logs/ingest.log \
  --resume
```
Notes:
- Whitelist of top-level folders is enforced when pointing to a root folder (e.g., `Gasable_hrn`), but single-file ingestion bypasses that.
- PDFs: PyPDF → PyMuPDF fallback; OCR via Tesseract (`ara+eng`) if text extraction is poor.

API:
```bash
curl -X POST http://127.0.0.1:8000/api/ingest_local \
  -H 'Content-Type: application/json' \
  -d '{"path":"/absolute/path"}'
```

Serverless note:
- The Netlify Functions API in this repo does not expose ingestion endpoints (by design, Functions have short timeouts). Use the local CLI above or deploy the full FastAPI backend for ingestion endpoints.

### Web ingestion
- DuckDuckGo/search + sitemap crawl:
```bash
curl -X POST http://127.0.0.1:8000/api/ingest_web \
  -H 'Content-Type: application/json' \
  -d '{"query":"site:example.com", "max_results": 50}'
```
- BFS same-domain crawl:
```bash
curl -X POST http://127.0.0.1:8000/api/crawl_site \
  -H 'Content-Type: application/json' \
  -d '{"base":"https://example.com", "max_pages": 200}'
```
- Direct URL list (PDF/HTML):
```bash
curl -X POST http://127.0.0.1:8000/api/ingest_urls \
  -H 'Content-Type: application/json' \
  -d '{"urls":["https://example.com/report.pdf","https://example.com/page"]}'
```

### Firecrawl OS (optional)
Run Firecrawl Open Source (docker-compose recommended). Set `FIRECRAWL_BASE_URL=http://127.0.0.1:3002`.
- Crawl and ingest via API:
```bash
curl -X POST http://127.0.0.1:8000/api/ingest_firecrawl \
  -H 'Content-Type: application/json' \
  -d '{"base":"https://example.com", "max_pages": 300}'
```

### Google Drive (optional)
```bash
curl -X POST http://127.0.0.1:8000/api/ingest_drive \
  -H 'Content-Type: application/json' \
  -d '{"folder_id":"your_folder_id"}'
```

## Querying (RAG)
- Single-shot (Serverless Functions default):
```bash
curl -X POST https://<your-netlify-site>.netlify.app/api/query \
  -H 'Content-Type: application/json' \
  -d '{"q": "Customer segments for diesel in F&B sector in KSA"}'
```
Response includes: `answer`, `answer_html`, `context_ids`.

- Single-shot (Full FastAPI):
```bash
curl -X POST http://127.0.0.1:8000/api/query \
  -H 'Content-Type: application/json' \
  -d '{"q": "Customer segments for diesel in F&B sector in KSA"}'
```
Response includes: `answer`, `answer_html`, `trace`, and `context_ids`.

- Streaming (SSE, Full FastAPI):
```bash
curl -N "http://127.0.0.1:8000/api/query_stream?q=best%20pricing%20model%20for%20diesel%20delivery"
```

- Customer-needs answer format
  - Hybrid retrieval (dense + BM25 + keyword SQL prefilter)
  - Reciprocal Rank Fusion → MMR selection (diverse, deduped)
  - Answer structured as: customer need summary, key evidence bullets (with citations), recommended next steps

## API Reference

- UI
  - `GET /` – welcome
  - `GET /dashboard` – simple DB dashboard (counts, samples)

- Serverless Functions (Netlify)
  - `POST /api/query` – body: `{ "q": string }` (BM25 lexical answer)
  - `GET  /api/status`
  - `GET  /api/db_stats`

- Health/Status (Full FastAPI)
  - `GET /api/status` – DB health and process IDs
  - `GET /api/db_stats` – counts for `gasable_index`, `embeddings`, `documents`

- RAG (Full FastAPI)
  - `POST /api/query` – body: `{ "q": string }`
  - `GET  /api/query_stream` – query: `?q=...` (SSE)

- Ingestion (Full FastAPI)
  - `POST /api/ingest_local` – `{ path }`
  - `POST /api/ingest_web` – `{ query, max_results?, allow_domains? }`
  - `POST /api/crawl_site` – `{ base, max_pages? }`
  - `POST /api/ingest_urls` – `{ urls: string[] }`
  - `POST /api/ingest_firecrawl` – `{ base, max_pages? }` (requires Firecrawl OS)
  - `POST /api/ingest_drive` – `{ folder_id }`

- DB Introspection
  - `GET /api/db/schemas`
  - `GET /api/db/tables`
  - `GET /api/db/table/{schema}/{table}/columns`
  - `GET /api/db/table/{schema}/{table}/count`
  - `GET /api/db/table/{schema}/{table}/sample?limit=&offset=`
  - `GET /api/processed_files?limit=`
  - `GET /api/file_entries?file=&limit=&offset=&full=`

- Tools
  - `GET /api/mcp_tools` – discover MCP tool metadata

## Chatbot Integration

- Browser (Netlify Functions)
```javascript
async function ask(query) {
  const res = await fetch('https://<your-site>.netlify.app/api/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query })
  });
  const data = await res.json();
  return data.answer;
}
```

- Browser (Full FastAPI; ensure `CORS_ORIGINS` includes your domain or `*`):
```javascript
async function ask(query) {
  const res = await fetch('https://api.yourdomain.com/api/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query })
  });
  const data = await res.json();
  return data.answer;
}
```

- Python:
```python
import requests
r = requests.post('https://api.yourdomain.com/api/query', json={'q':'What are diesel customer segments in KSA?'})
print(r.json()['answer'])
```

- Streaming SSE (Node/Next.js):
```javascript
const ev = new EventSource('https://api.yourdomain.com/api/query_stream?q=hello');
ev.onmessage = (e) => console.log(e.data);
```

## Deployment Notes

- Cloud Run API is the primary production path; ensure envs match the 1536 lane.
- Full API backend locally: bind to `0.0.0.0` and place behind Nginx/Caddy; use HTTPS if exposed.
- Set `CORS_ORIGINS` to your chatbot domain(s) for browser usage.
- Secure DB: private network/VPC, least-privilege DB user.
- Tune pgvector index: adjust `lists` and consider `ANALYZE public.gasable_index;` after large ingests.

## API quick reference (Cloud Run)

Base: `https://<your-run-url>`

- Health
  - `GET /health` – liveness
  - `GET /api/status` – DB health, active embedding column
- Query
  - `POST /api/query` – `{ q }` → returns structured `answer` + `answer_html`
  - `GET  /api/query_stream?q=...` – streaming SSE with progress steps and final answer
- Ingestion
  - `POST /api/ingest_web` – `{ query, max_results?, allow_domains? }`
  - `POST /api/ingest_drive` – `{ folder_id }`
- Tools (token-protected)
  - `GET /api/mcp_tools`
  - `POST /api/mcp_invoke` – `{ name, args, token }`

## Troubleshooting

- No embeddings: ensure `OPENAI_API_KEY` is set and the model names are correct.
- PDF text empty: PyMuPDF or OCR will auto-fallback; install `tesseract` for OCR (`brew install tesseract`).
- Web crawl returns 0: site may block bots; try Firecrawl OS or provide direct URL lists to `/api/ingest_urls`.
- Server not reachable: open firewall port 8000 or proxy via 80/443.

## License
Internal Gasable project components with third-party open-source integrations (see `requirements.txt`).
