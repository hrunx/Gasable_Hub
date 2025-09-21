from __future__ import annotations

import os
from typing import List
from mcp.server.fastmcp import Context

from ..ingestion.web import search_duckduckgo, build_chunked_docs
from ..db.postgres import connect as pg_connect
from openai import OpenAI


def register(mcp):
	@mcp.tool()
	async def ingest_web(query: str, max_results: int = 10, allow_domains_csv: str = "", ctx: Context | None = None) -> dict:
		"""Search the web and ingest results into Postgres vector index.

		- query: search query
		- max_results: number of results to fetch from search
		- allow_domains_csv: optional comma-separated list of allowed domains
		"""
		allow = [d.strip() for d in allow_domains_csv.split(",") if d.strip()] if allow_domains_csv else []
		urls: List[str] = search_duckduckgo([query], max_results=max_results, allow_domains=allow)
		if not urls:
			return {"status": "ok", "ingested": 0, "written": 0, "urls": []}
		docs = build_chunked_docs(urls, chunk_chars=int(os.getenv("CHUNK_CHARS", "4000")))
		written = _upsert_embeddings_docs(docs)
		return {"status": "ok", "ingested": len(docs), "written": written, "urls": urls}


def _upsert_embeddings_docs(docs: list[dict]) -> int:
	client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
	model = os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-small")
	inserts = 0
	with pg_connect() as conn:
		with conn.cursor() as cur:
			for d in docs:
				did = d.get("id")
				text = d.get("text", "")
				if not did or not text:
					continue
				emb = client.embeddings.create(model=model, input=text)
				vec = emb.data[0].embedding
				vec_str = "[" + ",".join(f"{x:.8f}" for x in vec) + "]"
				cur.execute(
					"""
					INSERT INTO public.gasable_index (node_id, text, embedding, li_metadata)
					VALUES (%s, %s, %s::vector, '{}'::jsonb)
					ON CONFLICT (node_id) DO UPDATE SET text=EXCLUDED.text, embedding=EXCLUDED.embedding
					""",
					(did, text, vec_str),
				)
				inserts += 1
			conn.commit()
	return inserts


