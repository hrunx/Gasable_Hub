from __future__ import annotations

import os
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from openai import OpenAI
import psycopg2
from psycopg2 import sql
from rank_bm25 import BM25Okapi
import json
import re
import time
import html
import asyncio
from gasable_hub.tools import discover_tool_specs_via_dummy

from gasable_hub.ingestion.gdrive import (
	authenticate_google_drive,
	fetch_text_documents,
	fetch_text_documents_recursive,
)
from gasable_hub.ingestion.local import collect_local_docs
from gasable_hub.ingestion.web import (
    search_duckduckgo,
    build_chunked_docs,
    discover_site_urls,
    crawl_site_urls,
    firecrawl_local_crawl,
    build_docs_from_firecrawl_pages,
)
from gasable_hub.ingestion.indexer import index_documents
from sse_starlette.sse import EventSourceResponse
from fastapi.middleware.cors import CORSMiddleware


app = FastAPI()
templates = Jinja2Templates(directory="templates")
app.mount("/static", StaticFiles(directory="static"), name="static")

# CORS for external chatbot/frontends
_cors_env = os.getenv("CORS_ORIGINS", "*").strip()
if _cors_env == "*":
	origins = ["*"]
else:
	origins = [o.strip() for o in _cors_env.split(",") if o.strip()]
app.add_middleware(
	CORSMiddleware,
	allow_origins=origins,
	allow_credentials=True,
	allow_methods=["*"],
	allow_headers=["*"],
)


def _safe_embed_col() -> str:
	"""Return pgvector column to use for embeddings in public.gasable_index.

	Controlled by env var `PG_EMBED_COL`. If not set, auto-choose by `EMBED_DIM`.
	Allowed values: 'embedding', 'embedding_1536'. Defaults to 'embedding_1536' when
	EMBED_DIM == 1536; otherwise 'embedding'.
	"""
	col = (os.getenv("PG_EMBED_COL") or "").strip()
	if col in ("embedding", "embedding_1536"):
		return col
	# Auto based on dim
	dim = int(os.getenv("EMBED_DIM", os.getenv("OPENAI_EMBED_DIM", "3072")) or 3072)
	return "embedding_1536" if dim == 1536 else "embedding"


def _default_embed_model() -> str:
	"""Select sensible default embed model based on `EMBED_DIM` if none provided."""
	model = (os.getenv("OPENAI_EMBED_MODEL") or "").strip()
	if model:
		return model
	dim = int(os.getenv("EMBED_DIM", os.getenv("OPENAI_EMBED_DIM", "3072")) or 3072)
	return "text-embedding-3-small" if dim == 1536 else "text-embedding-3-large"


def get_pg_conn():
	# Prefer full DSN if provided (e.g., Neon / Netlify)
	dsn = os.getenv("DATABASE_URL") or os.getenv("NETLIFY_DATABASE_URL")
	if dsn:
		# Ensure SSL for managed Postgres (e.g., Supabase) unless explicitly disabled
		if "sslmode" not in dsn:
			if "?" in dsn:
				dsn = dsn + "&sslmode=require"
			else:
				dsn = dsn + "?sslmode=require"
		return psycopg2.connect(dsn)
	# Fallback to discrete params
	return psycopg2.connect(
		host=os.getenv("PG_HOST", "localhost"),
		port=int(os.getenv("PG_PORT", "5432")),
		user=os.getenv("PG_USER", os.getenv("USER", "postgres")),
		password=os.getenv("PG_PASSWORD", ""),
		database=os.getenv("PG_DBNAME", "gasable_db"),
	)



def embed_query(q: str) -> list[float]:
	client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
	resp = client.embeddings.create(model=_default_embed_model(), input=q)
	return resp.data[0].embedding


def upsert_embeddings(docs: list[dict]) -> int:
	client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
	inserts = 0
	with get_pg_conn() as conn:
		with conn.cursor() as cur:
			for d in docs:
				did = d.get("id")
				text = clean_text(d.get("text", ""))
				if not did or not text:
					continue
				api_key = os.getenv("OPENAI_API_KEY")
				if api_key:
					try:
						emb_resp = client.embeddings.create(model=_default_embed_model(), input=text)
						vec = emb_resp.data[0].embedding
						vec_str = "[" + ",".join(f"{x:.8f}" for x in vec) + "]"
						# Choose embedding column dynamically
						col = _safe_embed_col()
						if col == "embedding_1536":
							cur.execute(
								f"""
								INSERT INTO public.gasable_index (node_id, text, embedding_1536, li_metadata)
								VALUES (%s, %s, %s::vector, '{{}}'::jsonb)
								ON CONFLICT (node_id) DO UPDATE SET text=EXCLUDED.text, embedding_1536=EXCLUDED.embedding_1536
								""",
								(did, text, vec_str),
							)
						else:
							cur.execute(
								f"""
								INSERT INTO public.gasable_index (node_id, text, embedding, li_metadata)
								VALUES (%s, %s, %s::vector, '{{}}'::jsonb)
								ON CONFLICT (node_id) DO UPDATE SET text=EXCLUDED.text, embedding=EXCLUDED.embedding
								""",
								(did, text, vec_str),
							)
					except Exception:
						# Fallback to text-only upsert if embedding fails
						cur.execute(
							"""
							INSERT INTO public.gasable_index (node_id, text, li_metadata)
							VALUES (%s, %s, '{}'::jsonb)
							ON CONFLICT (node_id) DO UPDATE SET text=EXCLUDED.text
							""",
							(did, text),
						)
				else:
					# No API key: text-only upsert
					cur.execute(
						"""
						INSERT INTO public.gasable_index (node_id, text, li_metadata)
						VALUES (%s, %s, '{}'::jsonb)
						ON CONFLICT (node_id) DO UPDATE SET text=EXCLUDED.text
						""",
						(did, text),
					)
				inserts += 1
			conn.commit()
	return inserts


def vector_search(query_embedding: list[float], k: int = 5):
	with get_pg_conn() as conn:
		with conn.cursor() as cur:
			col = _safe_embed_col()
			pgvec = "[" + ",".join(f"{x:.8f}" for x in query_embedding) + "]"
			if col == "embedding_1536":
				cur.execute(
					"""
					SELECT node_id, text, 1 - (embedding_1536 <=> %s::vector) AS similarity
					FROM public.gasable_index
					ORDER BY similarity DESC
					LIMIT %s
					""",
					(pgvec, k),
				)
			else:
				cur.execute(
					"""
					SELECT node_id, text, 1 - (embedding <=> %s::vector) AS similarity
					FROM public.gasable_index
					ORDER BY similarity DESC
					LIMIT %s
					""",
					(pgvec, k),
				)
			return cur.fetchall()


def bm25_fallback(query: str, k: int = 5):
	# Retained for compatibility; superseded by hybrid_search
	with get_pg_conn() as conn:
		with conn.cursor() as cur:
			cur.execute("SELECT node_id, text FROM public.gasable_index LIMIT 1000")
			rows = cur.fetchall()
	if not rows:
		return []
	texts = [t or "" for _, t in rows]
	tokenized = [t.split() for t in texts]
	filtered = [(rows[i], toks) for i, toks in enumerate(tokenized) if len(toks) > 0]
	if not filtered:
		return []
	kept_rows, kept_tokens = zip(*filtered)
	bm25 = BM25Okapi(list(kept_tokens))
	q_tokens = query.split()
	if not q_tokens:
		return []
	scores = bm25.get_scores(q_tokens)
	pairs = list(zip(kept_rows, scores))
	pairs.sort(key=lambda x: x[1], reverse=True)
	return [(node, text, float(score)) for ((node, text), score) in pairs[:k]]


# --- Robust multilingual hybrid RAG helpers ---

ARABIC_RE = re.compile(r"[\u0600-\u06FF]")
BM25_STATE: dict | None = None  # cached BM25 index


def detect_language(text: str) -> str:
	return "ar" if ARABIC_RE.search(text or "") else "en"


def normalize_text(text: str) -> str:
	# Basic cleanup suitable for both English and Arabic
	if not text:
		return ""
	text = re.sub("[\u0640]", "", text)  # remove tatweel
	text = re.sub(r"\s+", " ", text).strip()
	return text


def clean_text(text: str) -> str:
	"""Aggressive cleaning for OCR/PDF artifacts and noisy IDs.

	- Fix hyphenation across line breaks: "germinat- ed" → "germinated"
	- Remove gid-like path spam: "/gid00017/gid00045/..." and isolated gid tokens
	- Drop soft hyphens and invisible artifacts
	- Normalize whitespace and repeated punctuation
	"""
	if not text:
		return ""
	# Remove soft hyphen and odd control chars
	t = text.replace("\u00ad", "")
	# Join hyphenated breaks: letter - spaces letter → join
	t = re.sub(r"(?<=[A-Za-z\u0600-\u06FF])\-\s+(?=[A-Za-z\u0600-\u06FF])", "", t)
	# Remove gid path spam
	t = re.sub(r"(?:\s*/gid\d{5})+", " ", t, flags=re.IGNORECASE)
	t = re.sub(r"gid\d{5}", " ", t, flags=re.IGNORECASE)
	# Collapse excessive slashes and separators
	t = re.sub(r"\s*/\s*", " / ", t)
	# Remove sequences of non-word gibberish blocks
	t = re.sub(r"[^\w\u0600-\u06FF\.\,;:!\?\-()\[\]\{\}\s]+", " ", t)
	# Normalize dashes and ellipses
	t = t.replace("–", "-").replace("—", "-").replace("…", "...")
	# Final whitespace and punctuation cleanup
	t = re.sub(r"([\.!?،])\1{2,}", r"\1\1", t)
	t = re.sub(r"\s+", " ", t).strip()
	return t


class TraceRecorder:
	def __init__(self) -> None:
		self.steps: list[dict] = []

	def add(self, step: str, meta: dict | None = None, t0: float | None = None) -> None:
		now = time.time()
		item: dict = {"step": step, "ts": now}
		if t0 is not None:
			item["duration_ms"] = int((now - t0) * 1000)
		if meta is not None:
			item["meta"] = meta
		self.steps.append(item)


def markdown_to_html_simple(md: str) -> str:
	"""Convert a tiny subset of Markdown to safe HTML (paragraphs + bullets)."""
	if not md:
		return ""
	s = html.escape(md)
	blocks = re.split(r"\n\s*\n", s.strip())
	parts: list[str] = []
	for block in blocks:
		lines = [ln for ln in block.split("\n") if ln.strip()]
		is_list = any(re.match(r"\s*[-•]\s+", ln) for ln in lines)
		if is_list:
			bullet_re = re.compile(r"^\s*[-•]\s+")
			list_html = "".join("<li>" + bullet_re.sub("", ln) + "</li>" for ln in lines)
			parts.append("<ul>" + list_html + "</ul>")
		else:
			parts.append("<p>" + " ".join(lines) + "</p>")
	return "\n".join(parts)


def _vec_to_pg(vec: list[float]) -> str:
	return "[" + ",".join(f"{x:.8f}" for x in vec) + "]"


def _load_corpus(limit_per_table: int = 1500) -> list[tuple[str, str]]:
	"""Return list of (doc_id, text) across gasable_index, documents, embeddings."""
	items: list[tuple[str, str]] = []
	with get_pg_conn() as conn:
		with conn.cursor() as cur:
			# gasable_index
			cur.execute("SELECT node_id, COALESCE(text,'') FROM public.gasable_index LIMIT %s", (limit_per_table,))
			for r in cur.fetchall():
				items.append((f"gasable_index:{r[0]}", clean_text(r[1])))
			# documents
			cur.execute("SELECT id::text, COALESCE(content,'') FROM public.documents ORDER BY id DESC LIMIT %s", (limit_per_table,))
			for r in cur.fetchall():
				items.append((f"documents:{r[0]}", clean_text(r[1])))
			# embeddings chunks
			cur.execute("SELECT id::text, COALESCE(chunk_text,'') FROM public.embeddings ORDER BY id DESC LIMIT %s", (limit_per_table,))
			for r in cur.fetchall():
				items.append((f"embeddings:{r[0]}", clean_text(r[1])))
	return items


def _build_bm25_index() -> dict:
	"""Build and cache a BM25 index across a limited corpus."""
	global BM25_STATE
	limit = int(os.getenv("RAG_CORPUS_LIMIT", "600"))
	corpus = _load_corpus(limit_per_table=limit)
	rows: list[tuple[str, str]] = []
	tokens: list[list[str]] = []
	for doc_id, text in corpus:
		norm = normalize_text(text)
		ts = norm.split()
		if not ts:
			continue
		rows.append((doc_id, norm))
		tokens.append(ts)
	bm25 = BM25Okapi(tokens) if tokens else None
	BM25_STATE = {
		"built_at": time.time(),
		"rows": rows,
		"tokens": tokens,
		"bm25": bm25,
		"doc_count": len(rows),
	}
	return BM25_STATE


def _get_bm25_state() -> dict:
	global BM25_STATE
	# Rebuild if missing or TTL expired
	ttl = int(os.getenv("RAG_BM25_TTL_SEC", "300"))
	if BM25_STATE is None:
		return _build_bm25_index()
	if time.time() - float(BM25_STATE.get("built_at", 0)) > ttl:
		return _build_bm25_index()
	return BM25_STATE


def _bm25_search(query: str, k: int = 10) -> list[tuple[str, str, float]]:
	state = _get_bm25_state()
	bm25: BM25Okapi | None = state.get("bm25")  # type: ignore[assignment]
	rows: list[tuple[str, str]] = state.get("rows", [])  # (doc_id, norm_text)
	if not bm25 or not rows:
		return []
	q_tokens = normalize_text(query).split()
	if not q_tokens:
		return []
	scores = bm25.get_scores(q_tokens)
	pairs = list(zip(rows, scores))
	pairs.sort(key=lambda x: x[1], reverse=True)
	out: list[tuple[str, str, float]] = []
	for (doc_id, text), score in pairs[:k]:
		out.append((doc_id, text, float(score)))
	return out


def embed_queries(queries: list[str]) -> list[list[float]]:
	client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
	resp = client.embeddings.create(model=_default_embed_model(), input=queries)
	# Preserve order
	return [d.embedding for d in resp.data]


def _vector_search_combined(query_vec: list[float], k_each: int = 10) -> list[dict]:
	"""Vector search across gasable_index and embeddings; return unified list."""
	pgvec = _vec_to_pg(query_vec)
	results: list[dict] = []
	with get_pg_conn() as conn:
		with conn.cursor() as cur:
			# gasable_index cosine similarity (higher is better)
			col = _safe_embed_col()
			if col == "embedding_1536":
				cur.execute(
					"""
					SELECT 'gasable_index' AS source, node_id AS id, COALESCE(text,'') AS text,
					       1 - (embedding_1536 <=> %s::vector) AS score
					FROM public.gasable_index
					ORDER BY score DESC
					LIMIT %s
					""",
					(pgvec, k_each),
				)
			else:
				cur.execute(
					"""
					SELECT 'gasable_index' AS source, node_id AS id, COALESCE(text,'') AS text,
					       1 - (embedding <=> %s::vector) AS score
					FROM public.gasable_index
					ORDER BY score DESC
					LIMIT %s
					""",
					(pgvec, k_each),
				)
			for r in cur.fetchall():
				results.append({"source": r[0], "id": r[1], "text": clean_text(r[2]), "score": float(r[3])})
			# embeddings L2 distance (lower is better) → convert to similarity
			try:
				cur.execute(
					"""
					SELECT 'embeddings' AS source, id::text AS id, COALESCE(chunk_text,'') AS text,
					       1.0 / (1.0 + (embedding <-> %s::vector)) AS score
					FROM public.embeddings
					ORDER BY (embedding <-> %s::vector) ASC
					LIMIT %s
					""",
					(pgvec, pgvec, k_each),
				)
				for r in cur.fetchall():
					results.append({"source": r[0], "id": r[1], "text": clean_text(r[2]), "score": float(r[3])})
			except Exception:
				# If table or dims mismatch, skip gracefully
				pass
	return results


def _keyword_sql_prefilter(query: str, limit_each: int = 25) -> list[list[dict]]:
	"""Run lightweight SQL LIKE/ILIKE filters for domain keywords to catch exact mentions.

	Targets: gasable_index.text, documents.content, embeddings.chunk_text
	"""
	q_norm = normalize_text(query).lower()
	keywords = set()
	# Seed keywords by detecting important domain terms
	for kw in [
		"contract", "contracts", "supplier", "suppliers", "diesel", "fuel", "agreement", "terms", "pricing",
		"sow", "sla", "rfq", "tender", "bid", "procurement", "scope", "deliverables", "penalties", "liability",
		"payment", "incoterms", "delivery", "quantity", "quality", "specification"
	]:
		if kw in q_norm:
			keywords.add(kw)
	# Arabic hints
	for kw in [
		"عقد", "عقود", "مورد", "المورد", "موردين", "تزويد", "توريد", "ديزل", "وقود", "اتفاق", "اتفاقية",
		"شروط", "تسعير", "مناقصة", "عطاء", "توريدات", "دفعات", "دفع", "ترسية", "التزامات", "جزاءات",
		"حدود المسؤولية", "جودة", "كمية", "مواصفات", "تسليم", "جدول زمني"
	]:
		if kw in q_norm:
			keywords.add(kw)
	if not keywords:
		return []
	patterns = [f"%{k}%" for k in sorted(keywords)]
	results: list[list[dict]] = []
	with get_pg_conn() as conn:
		with conn.cursor() as cur:
			# gasable_index
			cur.execute(
				"""
				SELECT 'gasable_index' AS source, node_id AS id, left(COALESCE(text,''), 2000) AS text
				FROM public.gasable_index
				WHERE """ + " OR ".join(["text ILIKE %s"] * len(patterns)) + "\nLIMIT %s",
				(*patterns, limit_each),
			)
			rows = cur.fetchall()
			results.append([
				{"source": r[0], "id": r[1], "text": clean_text(r[2]), "score": 0.75}
				for r in rows
			])
			# documents
			cur.execute(
				"""
				SELECT 'documents' AS source, id::text AS id, left(COALESCE(content,''), 2000) AS text
				FROM public.documents
				WHERE """ + " OR ".join(["content ILIKE %s"] * len(patterns)) + "\nORDER BY id DESC LIMIT %s",
				(*patterns, limit_each),
			)
			rows = cur.fetchall()
			results.append([
				{"source": r[0], "id": r[1], "text": clean_text(r[2]), "score": 0.7}
				for r in rows
			])
			# embeddings chunks
			cur.execute(
				"""
				SELECT 'embeddings' AS source, id::text AS id, left(COALESCE(chunk_text,''), 2000) AS text
				FROM public.embeddings
				WHERE """ + " OR ".join(["chunk_text ILIKE %s"] * len(patterns)) + "\nORDER BY id DESC LIMIT %s",
				(*patterns, limit_each),
			)
			rows = cur.fetchall()
			results.append([
				{"source": r[0], "id": r[1], "text": clean_text(r[2]), "score": 0.65}
				for r in rows
			])
	return results


def _rrf_fuse(result_lists: list[list[dict]], k: int = 60) -> list[dict]:
	scores: dict[str, float] = {}
	meta: dict[str, dict] = {}
	for results in result_lists:
		for rank, r in enumerate(results, start=1):
			key = f"{r['source']}:{r['id']}"
			# Reciprocal Rank Fusion
			scores[key] = scores.get(key, 0.0) + 1.0 / (k + rank)
			if key not in meta:
				meta[key] = r
	# Sort by fused scores desc
	ordered = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
	return [meta[key] | {"rrf": val} for key, val in ordered]


def _tokenize_for_similarity(text: str) -> set[str]:
	if not text:
		return set()
	# Simple tokenization; keep alphanumerics of length >= 3
	parts = re.findall(r"[A-Za-z\u0600-\u06FF][A-Za-z0-9_\u0600-\u06FF]{2,}", text.lower())
	return set(parts[:2000])


def _jaccard_sim(a: set[str], b: set[str]) -> float:
	if not a or not b:
		return 0.0
	inter = len(a & b)
	union = len(a | b)
	return float(inter) / float(union or 1)


def _mmr_select(candidates: list[dict], k: int = 6, lambda_weight: float = 0.7) -> list[dict]:
	"""Maximal Marginal Relevance over fused candidates using token Jaccard similarity.

	Each candidate must include 'text' and 'rrf' fields. Returns up to k candidates.
	"""
	if not candidates:
		return []
	# Precompute token sets
	for c in candidates:
		c.setdefault("_tokens", _tokenize_for_similarity(c.get("text", "")))
	selected: list[dict] = []
	remaining = candidates[:]
	while remaining and len(selected) < k:
		best: tuple[float, int] | None = None
		for idx, cand in enumerate(remaining):
			sim_to_sel = 0.0
			if selected:
				# Compute max similarity to already selected
				for s in selected:
					sim = _jaccard_sim(cand.get("_tokens", set()), s.get("_tokens", set()))
					if sim > sim_to_sel:
						sim_to_sel = sim
			score = lambda_weight * float(cand.get("rrf", 0.0)) - (1.0 - lambda_weight) * sim_to_sel
			if (best is None) or (score > best[0]):
				best = (score, idx)
		if best is None:
			break
		_, pick_idx = best
		selected.append(remaining.pop(pick_idx))
	return selected


def _generate_query_expansions(q: str, lang: str) -> list[str]:
	api_key = os.getenv("OPENAI_API_KEY")
	if not api_key:
		return [q]
	client = OpenAI(api_key=api_key)
	prompt = (
		"You rewrite the user's question into up to 4 concise search queries. "
		"Provide: synonyms, rephrasings, and a translation to the other language (English/Arabic) if helpful. "
		"Return a JSON array of strings only."
	)
	try:
		resp = client.chat.completions.create(
			model=os.getenv("OPENAI_MODEL", "gpt-5-mini"),
			messages=[
				{"role": "system", "content": "You produce only JSON arrays of search queries. Always include at least one Arabic and one English variant if the question is not already bilingual."},
				{"role": "user", "content": f"Question language: {lang}. Original: {q}\n{prompt}"},
			],
		)
		content = resp.choices[0].message.content or "[]"
		# Try to extract array; accept bare array or object with key
		try:
			arr = json.loads(content)
			if isinstance(arr, dict):
				# pick first array-like value
				for v in arr.values():
					if isinstance(v, list):
						arr = v
						break
			if isinstance(arr, list):
				items = [str(x) for x in arr if isinstance(x, (str, int, float))]
				items = [x for x in items if x.strip()]
				return [q] + [x for x in items if x.strip() and x.strip() != q][:4]
		except Exception:
			pass
	except Exception:
		pass
	# Limit expansions for latency
	max_exp = int(os.getenv("RAG_EXPANSIONS", "2"))
	arr = [q]
	seen = {q}
	for x in arr[: 1 + max_exp]:
		pass
	return arr[: 1 + max_exp]


def hybrid_search(query: str, top_k: int = 6) -> list[tuple[str, str, float]]:
	"""Hybrid dense + lexical across multiple tables with RRF fusion."""
	lang = detect_language(query)
	expanded = _generate_query_expansions(query, lang)
	corpus = _load_corpus(limit_per_table=int(os.getenv("RAG_CORPUS_LIMIT", "1200")))
	# Dense results (batch embeddings)
	dense_lists: list[list[dict]] = []
	if os.getenv("OPENAI_API_KEY") and expanded:
		try:
			vecs = embed_queries(expanded)
			for vec in vecs:
				res = _vector_search_combined(vec, k_each=int(os.getenv("RAG_K_DENSE_EACH", "8")))
				res.sort(key=lambda r: r["score"], reverse=True)
				dense_lists.append(res[: int(os.getenv("RAG_K_DENSE_FUSE", "10"))])
		except Exception:
			pass
	# Lexical results
	lex_lists: list[list[dict]] = []
	for q2 in expanded:
		lex = _bm25_search(q2, k=int(os.getenv("RAG_K_LEX", "12")))
		lex_lists.append([
			{"source": did.split(":", 1)[0], "id": did.split(":", 1)[1], "text": txt, "score": float(score)}
			for (did, txt, score) in lex
		])

	# Keyword SQL prefilter to boost recall on domain-specific queries (e.g., contracts, suppliers, diesel)
	kw_lists = _keyword_sql_prefilter(query)
	lex_lists.extend([lst for lst in kw_lists if lst])
	# Fuse then apply MMR for diversity and dedup
	fused = _rrf_fuse(dense_lists + lex_lists)
	mmr = _mmr_select(fused, k=top_k, lambda_weight=float(os.getenv("RAG_MMR_LAMBDA", "0.7")))
	# Return as tuples (id, text, score)
	out: list[tuple[str, str, float]] = []
	for r in mmr:
		out.append((f"{r['source']}:{r['id']}", r.get("text", ""), float(r.get("score", 0.0))))
	return out


def generate_answer_robust(query: str, context_chunks: list[tuple[str, str, float]], lang_hint: str | None = None) -> str:
	client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
	lang = lang_hint or detect_language(query)
	context = "\n---\n".join(normalize_text(clean_text(text)) for _, text, _ in context_chunks)
	guard = (
		"Use ONLY the provided context. If context is insufficient or irrelevant, say one of: "
		"'لا يتوفر سياق كافٍ' in Arabic or 'No relevant context available.' in English. "
		"You work for Gasable; keep tone factual. Remove OCR noise, join hyphenated words, and avoid repeating gibberish. "
		"Validate that the final answer is coherent and fully addresses the question; if not, refine succinctly once. "
		"Cite key facts concisely. Answer in the user's language."
	)
	sys = (
		"You are a precise bilingual assistant (English and Arabic) for Gasable. "
		"Ground every answer strictly in the given context and don't fabricate. "
		"Structure answers around customer needs: problem, relevant insights from context, and recommended next actions (bulleted)."
	)
	resp = client.chat.completions.create(
		model=os.getenv("OPENAI_MODEL", "gpt-5-mini"),
		messages=[
			{"role": "system", "content": sys},
			{"role": "user", "content": f"Language: {lang}\nQuestion: {query}\nContext:\n{context}\n{guard}\nProvide a concise, accurate answer that includes: (1) customer need summary, (2) key evidence bullets with citations, (3) recommended next steps:"},
		],
	)
	return resp.choices[0].message.content


def generate_answer(query: str, context_chunks: list[tuple[str, str, float]]) -> str:
	client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
	context = "\n".join(text for _, text, _ in context_chunks)
	guard = "Only answer using the provided Context. If Context is empty or unrelated, say: 'No context available.'"
	prompt = f"Query: {query}\nContext:\n{context}\n{guard}\nAnswer succinctly:"
	resp = client.chat.completions.create(
		model=os.getenv("OPENAI_MODEL", "gpt-5-mini"),
		messages=[
			{"role": "system", "content": "You are a helpful assistant for Gasable Hub."},
			{"role": "user", "content": prompt},
		],
	)
	return resp.choices[0].message.content


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
	return templates.TemplateResponse("index.html", {"request": request})


@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard(request: Request):
    return templates.TemplateResponse("dashboard.html", {"request": request})


@app.post("/api/query")
async def api_query(payload: dict):
	q = payload.get("q", "").strip()
	if not q:
		return JSONResponse({"error": "Empty query"}, status_code=400)
	try:
		trace = TraceRecorder()
		lang = detect_language(q)
		trace.add("received_query", {"q_preview": q[:120], "lang": lang})
		t0 = time.time()
		rows = hybrid_search(q, top_k=int(os.getenv("RAG_TOP_K", "6")))
		trace.add("retrieval_done", {"num_chunks": len(rows)}, t0)
		t0 = time.time()
		answer = generate_answer_robust(q, rows, lang_hint=lang)
		trace.add("answer_generated", {"chars": len(answer or "")}, t0)
		# Produce a simple HTML for UI
		answer_html = markdown_to_html_simple(answer)
		# Summarize context ids for UI visibility (no raw text leak)
		ctx_ids = [cid for (cid, _txt, _sc) in rows]
		return {"answer": answer, "answer_html": answer_html, "trace": trace.steps, "context_ids": ctx_ids}
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/query_stream")
async def api_query_stream(request: Request, q: str):
	async def event_gen():
		try:
			lang = detect_language(q)
			yield {"event": "step", "data": json.dumps({"step": "received_query", "lang": lang})}
			# Expansions
			expanded = _generate_query_expansions(q, lang)
			yield {"event": "step", "data": json.dumps({"step": "expansions", "count": len(expanded)})}
			# Dense retrieval
			start = time.time()
			dense_lists: list[list[dict]] = []
			if os.getenv("OPENAI_API_KEY") and expanded:
				try:
					vecs = embed_queries(expanded)
					for vec in vecs:
						res = _vector_search_combined(vec, k_each=int(os.getenv("RAG_K_DENSE_EACH", "8")))
						res.sort(key=lambda r: r["score"], reverse=True)
						dense_lists.append(res[: int(os.getenv("RAG_K_DENSE_FUSE", "10"))])
					yield {"event": "step", "data": json.dumps({"step": "dense_retrieval", "lists": len(dense_lists), "ms": int((time.time()-start)*1000)})}
				except Exception as e:  # pragma: no cover
					yield {"event": "step", "data": json.dumps({"step": "dense_error", "error": str(e)})}
			# Lexical retrieval
			start = time.time()
			lex_lists: list[list[dict]] = []
			for q2 in expanded:
				lex = _bm25_search(q2, k=int(os.getenv("RAG_K_LEX", "12")))
				lex_lists.append([
					{"source": did.split(":", 1)[0], "id": did.split(":", 1)[1], "text": txt, "score": float(score)}
					for (did, txt, score) in lex
				])
			yield {"event": "step", "data": json.dumps({"step": "lex_retrieval", "lists": len(lex_lists), "ms": int((time.time()-start)*1000)})}
			# Fuse
			fused = _rrf_fuse(dense_lists + lex_lists)
			yield {"event": "step", "data": json.dumps({"step": "fusion", "candidates": len(fused)})}
			# Dedup and take top_k
			top_k = int(os.getenv("RAG_TOP_K", "6"))
			seen: set[str] = set()
			rows: list[tuple[str, str, float]] = []
			for r in fused:
				norm = normalize_text(r.get("text", ""))
				if not norm:
					continue
				key = norm[:256]
				if key in seen:
					continue
				seen.add(key)
				rows.append((f"{r['source']}:{r['id']}", r["text"], float(r.get("score", 0.0))))
				if len(rows) >= top_k:
					break
			yield {"event": "step", "data": json.dumps({"step": "selected_context", "count": len(rows)})}
			# Answer
			start = time.time()
			answer = generate_answer_robust(q, rows, lang_hint=lang)
			answer_html = markdown_to_html_simple(answer)
			ctx_ids = [cid for (cid, _t, _s) in rows]
			yield {"event": "final", "data": json.dumps({"answer": answer, "answer_html": answer_html, "context_ids": ctx_ids, "ms": int((time.time()-start)*1000)})}
		except Exception as e:  # pragma: no cover
			yield {"event": "final", "data": json.dumps({"error": str(e)})}
		return

	return EventSourceResponse(event_gen())


@app.get("/api/mcp_tools")
async def api_mcp_tools():
    try:
        specs = discover_tool_specs_via_dummy()
        # Minimal shape cleanup for UI
        for s in specs:
            s.setdefault("description", "")
            s.setdefault("module", "")
        return {"tools": specs}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/ingest_drive")
async def api_ingest_drive(payload: dict):
	folder_id = payload.get("folder_id") or os.getenv("GDRIVE_FOLDER_ID") or os.getenv("FOLDER_ID")
	if not folder_id:
		return JSONResponse({"error": "folder_id required"}, status_code=400)
	try:
		service = authenticate_google_drive()
		docs = fetch_text_documents_recursive(service, folder_id)
		if not docs:
			return {"status": "ok", "ingested": 0}
		# Store directly into gasable_index with embeddings
		written = upsert_embeddings(docs)
		return {"status": "ok", "ingested": len(docs), "written": written}
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/db_stats")
async def api_db_stats():
	with get_pg_conn() as conn:
		with conn.cursor() as cur:
			# Prefer exact count for clarity on dashboard
			cur.execute("SELECT COUNT(*) FROM public.gasable_index")
			count = cur.fetchone()[0]
			cur.execute("SELECT COUNT(*) FROM public.embeddings")
			emb_count = cur.fetchone()[0]
			cur.execute("SELECT COUNT(*) FROM public.documents")
			doc_count = cur.fetchone()[0]
			cur.execute("SELECT node_id, left(text, 200) FROM public.gasable_index LIMIT 3")
			samples = cur.fetchall()
			# Column diagnostics
			emb_1536 = None
			try:
				cur.execute("SELECT COUNT(*) FROM public.gasable_index WHERE embedding_1536 IS NOT NULL")
				emb_1536 = cur.fetchone()[0]
			except Exception:
				emb_1536 = None
			emb_legacy = None
			try:
				cur.execute("SELECT COUNT(*) FROM public.gasable_index WHERE embedding IS NOT NULL")
				emb_legacy = cur.fetchone()[0]
			except Exception:
				emb_legacy = None
			active_col = _safe_embed_col()
	return {
		"gasable_index": int(count),
		"embeddings": int(emb_count),
		"documents": int(doc_count),
		"samples": samples,
		"embedding_col": active_col,
		"embedding_counts": {"embedding": emb_legacy, "embedding_1536": emb_1536},
	}


@app.get("/api/status")
async def api_status():
    # Report simple status including DB health and process IDs if available
    pids = None
    try:
        import json
        with open("storage/pids.json", "r", encoding="utf-8") as f:
            pids = json.load(f)
    except Exception:
        pids = None
    health = {"status": "unknown"}
    try:
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
        health = {"status": "ok"}
    except Exception as e:
        health = {"status": "error", "error": str(e)}
    active_col = _safe_embed_col()
    return {"db": health, "pids": pids, "embedding_col": active_col}


@app.get("/health")
async def health():
	# Lightweight liveness endpoint for Cloud Run
	return {"status": "ok"}


@app.get("/api/db/schemas")
async def api_db_schemas():
	try:
		with get_pg_conn() as conn:
			with conn.cursor() as cur:
				cur.execute(
					"""
					SELECT nspname AS schema
					FROM pg_namespace
					WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'
					ORDER BY 1
					"""
				)
				schemas = [row[0] for row in cur.fetchall()]
		return {"schemas": schemas}
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/db/tables")
async def api_db_tables():
	"""List user tables with estimated row counts and sizes (bytes)."""
	try:
		with get_pg_conn() as conn:
			with conn.cursor() as cur:
				cur.execute(
					"""
					SELECT
					  n.nspname AS schema,
					  c.relname AS table,
					  COALESCE(s.n_live_tup, 0) AS est_rows,
					  pg_total_relation_size(c.oid) AS total_bytes
					FROM pg_class c
					JOIN pg_namespace n ON n.oid = c.relnamespace
					LEFT JOIN pg_stat_user_tables s ON s.relname = c.relname AND s.schemaname = n.nspname
					WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
					ORDER BY n.nspname, c.relname
					"""
				)
				rows = cur.fetchall()
				result = [
					{"schema": r[0], "table": r[1], "est_rows": int(r[2]), "total_bytes": int(r[3])}
					for r in rows
				]
				# Compute exact row counts (may be slower on huge tables)
				for t in result:
					try:
						q = sql.SQL("SELECT COUNT(*) FROM {}.{}").format(sql.Identifier(t["schema"]), sql.Identifier(t["table"]))
						cur.execute(q)
						t["exact_rows"] = int(cur.fetchone()[0])
					except Exception:
						# Keep estimate if exact fails
						pass
		return {"tables": result}
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/db/table/{schema}/{table}/columns")
async def api_db_table_columns(schema: str, table: str):
	try:
		with get_pg_conn() as conn:
			with conn.cursor() as cur:
				cur.execute(
					"""
					SELECT column_name, data_type, is_nullable, ordinal_position
					FROM information_schema.columns
					WHERE table_schema = %s AND table_name = %s
					ORDER BY ordinal_position
					""",
					(schema, table),
				)
				cols = [
					{"name": r[0], "type": r[1], "nullable": r[2] == "YES", "position": int(r[3])}
					for r in cur.fetchall()
				]
				cur.execute(
					"""
					SELECT indexname, indexdef
					FROM pg_indexes
					WHERE schemaname = %s AND tablename = %s
					ORDER BY 1
					""",
					(schema, table),
				)
				idx = [{"name": r[0], "def": r[1]} for r in cur.fetchall()]
		return {"columns": cols, "indexes": idx}
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/db/table/{schema}/{table}/count")
async def api_db_table_count(schema: str, table: str):
	try:
		with get_pg_conn() as conn:
			with conn.cursor() as cur:
				query = sql.SQL("SELECT COUNT(*) FROM {}.{}").format(sql.Identifier(schema), sql.Identifier(table))
				cur.execute(query)
				count = cur.fetchone()[0]
		return {"count": int(count)}
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/db/table/{schema}/{table}/sample")
async def api_db_table_sample(schema: str, table: str, limit: int = 50, offset: int = 0):
	try:
		limit = max(1, min(limit, 2000))
		offset = max(0, offset)
		with get_pg_conn() as conn:
			with conn.cursor() as cur:
				query = sql.SQL("SELECT * FROM {}.{} OFFSET %s LIMIT %s").format(sql.Identifier(schema), sql.Identifier(table))
				cur.execute(query, (offset, limit))
				rows = cur.fetchall()
				columns = [d[0] for d in cur.description] if cur.description else []
				data = [list(r) for r in rows]
		return {"columns": columns, "rows": data}
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/processed_files")
async def api_processed_files(limit: int = 10000):
	"""List file names (prefix before #chunk) grouped with counts from gasable_index."""
	try:
		limit = max(1, min(limit, 100000))
		with get_pg_conn() as conn:
			with conn.cursor() as cur:
				cur.execute(
					"""
					SELECT
					  CASE WHEN position('#' in node_id) > 0 THEN left(node_id, position('#' in node_id)-1) ELSE node_id END AS file,
					  COUNT(*) AS cnt
					FROM public.gasable_index
					GROUP BY 1
					ORDER BY cnt DESC
					LIMIT %s
					""",
					(limit,)
				)
				rows = cur.fetchall()
				files = [{"file": r[0], "count": int(r[1])} for r in rows]
		return {"files": files}
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/file_entries")
async def api_file_entries(file: str, limit: int = 500, offset: int = 0, full: int = 0):
	"""Return chunks for a given file prefix from gasable_index, including text and embedding preview.

	- file: exact prefix before #chunk (e.g., file:///path/to.pdf)
	- full: if 1, include full embedding text (can be large). Otherwise include a shortened preview.
	"""
	try:
		limit = max(1, min(limit, 5000))
		offset = max(0, offset)
		like = file + "#%"
		with get_pg_conn() as conn:
			with conn.cursor() as cur:
				col = _safe_embed_col()
				if col == "embedding_1536":
					cur.execute(
						"""
						SELECT node_id, COALESCE(text,''), CASE WHEN embedding_1536 IS NULL THEN NULL ELSE embedding_1536::text END AS embedding_text
						FROM public.gasable_index
						WHERE node_id LIKE %s
						ORDER BY node_id
						OFFSET %s LIMIT %s
						""",
						(like, offset, limit),
					)
				else:
					cur.execute(
						"""
						SELECT node_id, COALESCE(text,''), CASE WHEN embedding IS NULL THEN NULL ELSE embedding::text END AS embedding_text
						FROM public.gasable_index
						WHERE node_id LIKE %s
						ORDER BY node_id
						OFFSET %s LIMIT %s
						""",
						(like, offset, limit),
					)
				rows = cur.fetchall()
				items: list[dict] = []
				for nid, txt, emb in rows:
					emb_str = emb or ""
					if not full and emb_str:
						# Show a short preview
						preview = emb_str[:256]
						items.append({"node_id": nid, "text": txt, "embedding_preview": preview, "embedding_dim": None})
					else:
						items.append({"node_id": nid, "text": txt, "embedding": emb_str})
		return {"entries": items}
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/seed_facts")
async def api_seed_facts():
	seed = [
		{"id": "seed_gasable", "text": "Gasable is an energy marketplace."},
		{"id": "seed_haroon", "text": "Haroon is a regional manager or executive at Gasable."},
		{"id": "seed_ali", "text": "Ali Ghnaim is the CEO of Gasable."},
	]
	written = upsert_embeddings(seed)
	return {"status": "ok", "ingested": len(seed), "written": written}


@app.post("/api/ingest_local")
async def api_ingest_local(payload: dict):
	root_path = payload.get("path") or os.getenv("LOCAL_INGEST_PATH") or "/Users/hrn/Desktop/Gasable_hrn"
	if not os.path.exists(root_path):
		return JSONResponse({"error": f"path not found: {root_path}"}, status_code=400)
	try:
		docs = collect_local_docs(root_path)
		if not docs:
			return {"status": "ok", "ingested": 0, "written": 0}
		written = upsert_embeddings(docs)
		return {"status": "ok", "ingested": len(docs), "written": written}
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/ingest_web")
async def api_ingest_web(payload: dict):
	query = (payload.get("query") or payload.get("q") or "").strip()
	if not query:
		return JSONResponse({"error": "query is required"}, status_code=400)
	allow = payload.get("allow_domains") or os.getenv("WEB_ALLOW_DOMAINS", "")
	allow_list = [d.strip() for d in allow.split(",") if d.strip()] if allow else []
	max_results = int(payload.get("max_results") or os.getenv("WEB_MAX_RESULTS", "10"))
	try:
		urls = []
		if query.startswith("site:") and " " not in query:
			# If it's a pure site:domain query, discover sitemap URLs
			domain = query.split(":", 1)[1]
			urls = discover_site_urls(domain, max_urls=max_results)
		else:
			urls = search_duckduckgo([query], max_results=max_results, allow_domains=allow_list)
		if not urls:
			return {"status": "ok", "urls": [], "ingested": 0, "written": 0}
		docs = build_chunked_docs(urls, chunk_chars=int(os.getenv("CHUNK_CHARS", "4000")))
		written = upsert_embeddings(docs)
		return {"status": "ok", "urls": urls, "ingested": len(docs), "written": written}
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/crawl_site")
async def api_crawl_site(payload: dict):
	base = (payload.get("base") or payload.get("site") or "").strip()
	if not base:
		return JSONResponse({"error": "base is required (domain or URL)"}, status_code=400)
	max_pages = int(payload.get("max_pages") or os.getenv("CRAWL_MAX_PAGES", "100"))
	try:
		urls = crawl_site_urls(base, max_pages=max_pages)
		if not urls:
			return {"status": "ok", "urls": [], "ingested": 0, "written": 0}
		docs = build_chunked_docs(urls, chunk_chars=int(os.getenv("CHUNK_CHARS", "4000")))
		written = upsert_embeddings(docs)
		return {"status": "ok", "urls": urls[:50], "url_count": len(urls), "ingested": len(docs), "written": written}
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/ingest_urls")
async def api_ingest_urls(payload: dict):
	urls = payload.get("urls")
	if not isinstance(urls, list) or not urls:
		return JSONResponse({"error": "urls (list) is required"}, status_code=400)
	# Sanitize and dedupe
	urls = [str(u).strip() for u in urls if str(u).strip()]
	urls = list(dict.fromkeys(urls))
	try:
		docs = build_chunked_docs(urls, chunk_chars=int(os.getenv("CHUNK_CHARS", "4000")))
		written = upsert_embeddings(docs)
		return {"status": "ok", "urls": urls[:50], "url_count": len(urls), "ingested": len(docs), "written": written}
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/ingest_firecrawl")
async def api_ingest_firecrawl(payload: dict):
    base = (payload.get("base") or payload.get("site") or "").strip()
    if not base:
        return JSONResponse({"error": "base is required (domain or URL)"}, status_code=400)
    max_pages = int(payload.get("max_pages") or os.getenv("CRAWL_MAX_PAGES", "200"))
    try:
        pages = firecrawl_local_crawl(base, max_pages=max_pages)
        docs = build_docs_from_firecrawl_pages(pages, chunk_chars=int(os.getenv("CHUNK_CHARS", "4000")))
        written = upsert_embeddings(docs)
        return {"status": "ok", "url_count": len(pages), "ingested": len(docs), "written": written}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


