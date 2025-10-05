from __future__ import annotations

import os
import json
import re
from typing import List, Dict

import psycopg2
import psycopg2.extras
from openai import OpenAI


DB_URL = os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL") or os.getenv("NETLIFY_DATABASE_URL")
EMBED_MODEL = os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-large")
EMBED_DIM = int(os.getenv("OPENAI_EMBED_DIM", "1536"))

_oai = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def _pg():
	return psycopg2.connect(DB_URL, sslmode="require", cursor_factory=psycopg2.extras.RealDictCursor)


def embed_query(q: str) -> List[float]:
	res = _oai.embeddings.create(model=EMBED_MODEL, input=q, dimensions=EMBED_DIM)
	return res.data[0].embedding


def _safe_embed_col() -> str:
	# We standardize on embedding_1536 but preserve override for compatibility
	col = (os.getenv("PG_EMBED_COL") or "").strip()
	if col in ("embedding_1536", "embedding"):
		return col
	return "embedding_1536"


def vector_search(vec: List[float], agent_id: str, namespace: str, k: int = 40) -> List[Dict]:
	col = _safe_embed_col()
	vec_text = "[" + ",".join(str(float(x)) for x in vec) + "]"
	sql = f"""
	  select node_id as id,
	         coalesce(text, li_metadata->>'chunk') as txt,
	         li_metadata as metadata,
	         1 - ({col} <=> $1::vector) as score
	  from public.gasable_index
	  where (agent_id = $2 or agent_id = 'default') and namespace = $3
	  order by {col} <=> $1::vector
	  limit $4
	"""
	with _pg() as conn, conn.cursor() as cur:
		cur.execute(sql, (vec_text, agent_id, namespace, k))
		rows = cur.fetchall()
	return [dict(r) for r in rows]


def bm25_search(q: str, agent_id: str, namespace: str, k: int = 40) -> List[Dict]:
	sql = """
	  select node_id as id,
	         coalesce(text, li_metadata->>'chunk') as txt,
	         li_metadata as metadata,
	         ts_rank_cd(tsv, plainto_tsquery('simple', $1)) as score
	  from public.gasable_index
	  where (agent_id = $2 or agent_id = 'default') and namespace = $3
	    and tsv @@ plainto_tsquery('simple', $1)
	  order by score desc
	  limit $4
	"""
	with _pg() as conn, conn.cursor() as cur:
		cur.execute(sql, (q, agent_id, namespace, k))
		rows = cur.fetchall()
	return [dict(r) for r in rows]


def dedupe(hits: List[Dict]) -> List[Dict]:
	best: dict[str, Dict] = {}
	for h in hits:
		cur = best.get(h["id"])  # type: ignore[index]
		if not cur or float(h.get("score", 0)) > float(cur.get("score", 0)):
			best[h["id"]] = h
	out = list(best.values())
	out.sort(key=lambda x: float(x.get("score", 0)), reverse=True)
	return out


def rerank_llm(q: str, hits: List[Dict], top: int = 12, model: str = "gpt-5-mini") -> List[Dict]:
	if not hits:
		return hits
	def snip(s: str) -> str:
		return (s or "").replace("\n", " ")[:1200]
	passages = "\n\n".join(f"[{i}] {snip(h.get('txt',''))}" for i, h in enumerate(hits))
	sys = "Return strict JSON array of {index:int, score:float in [0,1]} sorted by relevance."
	r = _oai.chat.completions.create(
		model=model,
		temperature=0,
		messages=[
			{"role": "system", "content": sys},
			{"role": "user", "content": f"Query: {q}\n\nPassages:\n{passages}"},
		],
	)
	txt = r.choices[0].message.content or "[]"
	m = re.search(r"\[.*\]", txt, re.S)
	arr = json.loads(m.group(0) if m else txt)
	scored: list[Dict] = []
	for it in arr:
		idx = it.get("index")
		if isinstance(idx, int) and 0 <= idx < len(hits):
			scored.append({**hits[idx], "_rerank": float(it.get("score", 0))})
	scored.sort(key=lambda x: float(x.get("_rerank", 0)), reverse=True)
	return scored[:top]


def hybrid_query(q: str, agent_id: str, namespace: str, k: int = 12) -> Dict:
	qvec = embed_query(q)
	v = vector_search(qvec, agent_id, namespace, k=40)
	b = bm25_search(q, agent_id, namespace, k=40)
	hits = dedupe(v + b)
	hits = rerank_llm(q, hits, top=max(k, 12))
	return {"hits": hits[:k]}


