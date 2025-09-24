# Gasable Hub – RAG API and Ingestion

### What this hub does (for non‑technical readers)
- **All your energy intelligence in one place**: We collected Gasable’s documents (PDF/DOCX/TXT), key web pages, and research, then indexed them into a searchable knowledge base.
- **Understands Arabic + English**: High‑quality PDF extraction (Arabic included) with OCR fallback for scans.
- **Answers like a consultant**: The chatbot retrieves the most relevant evidence and answers with a clear structure: customer needs, supporting facts, and recommended next steps.
- **Works from anywhere**: A serverless UI (Netlify) and API endpoints let you use the hub from the web and integrate it into your own apps.

In short: it’s a robust, bilingual knowledge hub that helps you find facts fast, justify decisions, and move to action.

## Quick Start

- Requirements: Python 3.11+, PostgreSQL 14+ with `pgvector`, optional Docker for Firecrawl OS.
- Install deps:
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```
- Database: enable pgvector and table (if not already present):
```sql
-- in psql connected to your DB
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS public.gasable_index (
  node_id TEXT PRIMARY KEY,
  text TEXT,
  embedding vector(1536), -- OpenAI text-embedding-3-small
  li_metadata JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS gasable_index_embedding_ivfflat
  ON public.gasable_index USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```
- Configure environment (copy and edit):
```bash
# if you have an example file
# cp .env.example .env
# otherwise create .env with the variables below
```
Key environment variables:
- `OPENAI_API_KEY`: for embeddings and answers
- `OPENAI_EMBED_MODEL` (default `text-embedding-3-small`)
- `OPENAI_MODEL` (default `gpt-5-mini`)
- `PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASSWORD`, `PG_DBNAME`
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

### Serverless (Netlify) deployment – UI + API Functions
- This repo includes a Netlify static frontend and Netlify Functions API for a fully serverless setup.
- Files:
  - `index.html`, `dashboard.html` – static UI pages
  - `netlify/functions/api.py` – serverless API (BM25 search, status, db stats)
  - `netlify.toml` – routes `/api/*` to the Netlify Function

Set these Netlify environment variables (Site settings → Build & deploy → Environment):
- `PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASSWORD`, `PG_DBNAME`
- Optional: `RAG_TOP_K`

Deploy steps:
1) Connect GitHub repo to Netlify (done)
2) Ensure the env vars above are set
3) Trigger a deploy. Your site serves UI at `/` and `/dashboard`, and the API at `/api/...` via Functions.

Notes:
- Netlify Functions here return a fast lexical (BM25) answer. Streaming and hybrid dense retrieval run in the full FastAPI backend (see below) or can be added later under function time limits.
- Heavy ingestion should run via CLI or a dedicated backend service, not as Functions (due to runtime and memory limits).

### Serverless (Netlify Functions, TypeScript) – Neon pgvector RAG API
- This repo exposes `POST /api/query` implemented in Netlify Functions (TypeScript) hitting Neon pgvector directly.
- Files:
  - `netlify/functions/query.ts` – embeds query (OpenAI), searches pgvector on Neon, returns hits + optional answer
  - `netlify/functions/health.ts` – simple health check
  - `netlify/functions/api.js` – legacy dashboard endpoints
  - `netlify.toml` – routes `/api/query` → `functions/query`
- Netlify env vars:
  - `DATABASE_URL` – Neon pooled URL (sslmode=require)
  - `OPENAI_API_KEY`
  - `EMBED_MODEL` default `text-embedding-3-large`
  - `EMBED_DIM` default `3072` (match your index time)
  - `PG_SCHEMA` default `public`, `PG_TABLE` default `gasable_index`
  - `RERANK_MODEL` default `gpt-5-mini` (or `gpt-4o-mini`)

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

- Netlify Functions mode (UI+API): set DB env vars on Netlify; ingestion should be done via CLI or the full API backend.
- Full API backend: bind to `0.0.0.0` and place behind Nginx/Caddy; use HTTPS.
- Set `CORS_ORIGINS` to your chatbot domain(s) for browser usage.
- Secure DB: private network/VPC, least-privilege DB user.
- Tune pgvector index: adjust `lists` and consider `ANALYZE public.gasable_index;` after large ingests.

## Troubleshooting

- No embeddings: ensure `OPENAI_API_KEY` is set and the model names are correct.
- PDF text empty: PyMuPDF or OCR will auto-fallback; install `tesseract` for OCR (`brew install tesseract`).
- Web crawl returns 0: site may block bots; try Firecrawl OS or provide direct URL lists to `/api/ingest_urls`.
- Server not reachable: open firewall port 8000 or proxy via 80/443.

## License
Internal Gasable project components with third-party open-source integrations (see `requirements.txt`).
