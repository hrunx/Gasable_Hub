from __future__ import annotations

import os
import json
import re
from typing import List, Dict

from openai import OpenAI

from ..db.postgres import connect as pg_connect


EMBED_MODEL = os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-small")
EMBED_DIM = int(os.getenv("OPENAI_EMBED_DIM", "1536"))

_oai = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
EMBED_TTL_SEC = int(os.getenv("EMBED_TTL_SEC", "600") or 600)
_EMBED_CACHE: dict[str, tuple[List[float], float]] = {}


def _pg():
    """Return a Postgres connection via the shared helper."""
    return pg_connect()


def embed_query(q: str) -> List[float]:
    now = __import__("time").time()
    ent = _EMBED_CACHE.get(q)
    if ent and (now - ent[1] < EMBED_TTL_SEC):
        return ent[0]
    res = _oai.embeddings.create(model=EMBED_MODEL, input=q, dimensions=EMBED_DIM)
    vec = res.data[0].embedding
    _EMBED_CACHE[q] = (vec, now)
    # Simple size control
    if len(_EMBED_CACHE) > 2048:
        _EMBED_CACHE.pop(next(iter(_EMBED_CACHE)))
    return vec


def _safe_embed_col() -> str:
    # We standardize on embedding_1536 but preserve override for compatibility
    col = (os.getenv("PG_EMBED_COL") or "").strip()
    if col in ("embedding_1536", "embedding"):
        return col
    return "embedding_1536"


def _agent_keywords(agent_id: str) -> List[str]:
    """Derive up to 8 salient keywords from the agent's display name and system prompt.

    This steers retrieval toward agent-relevant chunks without requiring data relabeling.
    """
    try:
        with _pg() as conn, conn.cursor() as cur:
            cur.execute(
                "select display_name, system_prompt from public.gasable_agents where id=%s",
                (agent_id,),
            )
            row = cur.fetchone()
        text = " ".join([s for s in (row[0], row[1]) if isinstance(s, str)]) if row else ""
        text = (text or "").lower()
        # Simple tokenization; keep alphanumerics length>=4; drop common stopwords
        toks = re.findall(r"[a-zA-Z\u0600-\u06FF][a-zA-Z0-9_\u0600-\u06FF]{3,}", text)
        stop = {"agent","support","marketing","research","gasable","assistant","tool","tools","order","orders","help","query","answer","system","prompt","task","role"}
        out: List[str] = []
        seen = set()
        for t in toks:
            if t in stop or t in seen:
                continue
            seen.add(t)
            out.append(t)
            if len(out) >= 8:
                break
        return out
    except Exception:
        return []


def vector_search(vec: List[float], agent_id: str, namespace: str, k: int = 40) -> List[Dict]:
    col = _safe_embed_col()
    vec_text = "[" + ",".join(str(float(x)) for x in vec) + "]"
    # Optional keyword steering
    kws = _agent_keywords(agent_id)
    kw_clause = ""
    if kws:
        kw_clause = " AND (" + " OR ".join(["text ILIKE %s"] * len(kws)) + ")"
    sql = f"""
      select node_id as id,
             coalesce(text, li_metadata->>'chunk') as txt,
             li_metadata as metadata,
             1 - ({col} <=> $1::vector) as score
      from public.gasable_index
      where (agent_id = $2 or agent_id = 'default') and namespace = $3
      {kw_clause}
      order by {col} <=> $1::vector
      limit $4
    """
    with _pg() as conn, conn.cursor() as cur:
        params: List[object] = [vec_text, agent_id, namespace]
        if kws:
            params.extend([f"%{w}%" for w in kws])
        params.append(k)
        cur.execute(sql, params)
        rows = cur.fetchall()
    return [dict(r) for r in rows]


def bm25_search(q: str, agent_id: str, namespace: str, k: int = 40) -> List[Dict]:
    # Optional keyword steering
    kws = _agent_keywords(agent_id)
    kw_clause = ""
    if kws:
        kw_clause = " AND (" + " OR ".join(["text ILIKE %s"] * len(kws)) + ")"
    sql = f"""
      select node_id as id,
             coalesce(text, li_metadata->>'chunk') as txt,
             li_metadata as metadata,
             ts_rank_cd(tsv, plainto_tsquery('simple', $1)) as score
      from public.gasable_index
      where (agent_id = $2 or agent_id = 'default') and namespace = $3
        {kw_clause}
        and tsv @@ plainto_tsquery('simple', $1)
      order by score desc
      limit $4
    """
    with _pg() as conn, conn.cursor() as cur:
        params: List[object] = [q, agent_id, namespace]
        if kws:
            params.extend([f"%{w}%" for w in kws])
        params.append(k)
        cur.execute(sql, params)
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


def rerank_llm(q: str, hits: List[Dict], top: int = 12, model: str = "gpt-5-mini", enabled: bool = True) -> List[Dict]:
    if not hits:
        return hits
    if not enabled or str(os.getenv("RAG_RERANK", "1")).lower() not in ("1", "true"):  # allow disabling for speed
        return hits[:top]
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


def _load_agent_rag_settings(agent_id: str) -> Dict:
    try:
        with _pg() as conn, conn.cursor() as cur:
            cur.execute("select rag_settings from public.gasable_agents where id=%s", (agent_id,))
            row = cur.fetchone()
        return (row[0] or {}) if row else {}
    except Exception:
        return {}


def hybrid_query(q: str, agent_id: str, namespace: str, k: int = 12) -> Dict:
    cfg = _load_agent_rag_settings(agent_id)
    qvec = embed_query(q)
    v = vector_search(qvec, agent_id, namespace, k=40)
    b = bm25_search(q, agent_id, namespace, k=40)
    hits = dedupe(v + b)
    hits = rerank_llm(
        q,
        hits,
        top=max(k, 12),
        model=str(cfg.get("rerank_model") or os.getenv("RERANK_MODEL", os.getenv("OPENAI_MODEL", "gpt-5-mini"))),
        enabled=bool(cfg.get("rerank", True)),
    )
    return {"hits": hits[:k]}
