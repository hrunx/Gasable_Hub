import json
import os
import re
import psycopg2
from rank_bm25 import BM25Okapi
from urllib.parse import urlparse

def _pg():
    return psycopg2.connect(
        host=os.getenv("PG_HOST", "localhost"),
        port=int(os.getenv("PG_PORT", "5432")),
        user=os.getenv("PG_USER", os.getenv("USER", "postgres")),
        password=os.getenv("PG_PASSWORD", ""),
        database=os.getenv("PG_DBNAME", "gasable_db"),
    )

ARABIC_RE = re.compile(r"[\u0600-\u06FF]")

def _detect_lang(s: str) -> str:
    return "ar" if ARABIC_RE.search(s or "") else "en"

def _normalize(s: str) -> str:
    if not s: return ""
    s = re.sub("[\u0640]", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def _load_corpus(limit_per_table: int = 600):
    items = []
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT node_id, COALESCE(text,'') FROM public.gasable_index LIMIT %s", (limit_per_table,))
            items += [(f"gasable_index:{r[0]}", _normalize(r[1])) for r in cur.fetchall()]
            cur.execute("SELECT id::text, COALESCE(content,'') FROM public.documents ORDER BY id DESC LIMIT %s", (limit_per_table,))
            items += [(f"documents:{r[0]}", _normalize(r[1])) for r in cur.fetchall()]
            cur.execute("SELECT id::text, COALESCE(chunk_text,'') FROM public.embeddings ORDER BY id DESC LIMIT %s", (limit_per_table,))
            items += [(f"embeddings:{r[0]}", _normalize(r[1])) for r in cur.fetchall()]
    return items

def _bm25_search(q: str, k: int = 8):
    corpus = _load_corpus()
    rows = [r for r in corpus if r[1]]
    if not rows: return []
    tokens = [t.split() for _, t in rows]
    kept = [(rows[i], tok) for i, tok in enumerate(tokens) if tok]
    if not kept: return []
    kept_rows, kept_tokens = zip(*kept)
    bm25 = BM25Okapi(list(kept_tokens))
    scores = bm25.get_scores(_normalize(q).split())
    pairs = list(zip(kept_rows, scores))
    pairs.sort(key=lambda x: x[1], reverse=True)
    out = []
    for ((doc_id, text), score) in pairs[:k]:
        out.append((doc_id, text, float(score)))
    return out

def handler(event, context):
    # Map multiple endpoints for minimal viable Netlify Functions API
    path = event.get('path', '')
    http_method = event.get('httpMethod', 'GET')

    try:
        if path.endswith('/query') and http_method == 'POST':
            body = event.get('body') or '{}'
            data = json.loads(body)
            q = (data.get('q') or '').strip()
            if not q:
                return { 'statusCode': 400, 'body': json.dumps({'error':'Empty query'}) }
            rows = _bm25_search(q, k=int(os.getenv('RAG_TOP_K','6')))
            # Minimal answer: return top snippets concatenated
            answer = '\n\n'.join(t for (_id, t, _s) in rows)
            return { 'statusCode': 200, 'body': json.dumps({'answer': answer, 'answer_html': answer.replace('\n','<br>'), 'context_ids': [i for (i,_,__) in rows]}) }

        if path.endswith('/status'):
            try:
                with _pg() as conn:
                    with conn.cursor() as cur:
                        cur.execute('SELECT 1')
                        cur.fetchone()
                db = {'status':'ok'}
            except Exception as e:
                db = {'status':'error','error':str(e)}
            return { 'statusCode': 200, 'body': json.dumps({'db': db}) }

        if path.endswith('/db_stats'):
            with _pg() as conn:
                with conn.cursor() as cur:
                    cur.execute('SELECT COUNT(*) FROM public.gasable_index')
                    gi = cur.fetchone()[0]
                    cur.execute('SELECT COUNT(*) FROM public.embeddings')
                    em = cur.fetchone()[0]
                    cur.execute('SELECT COUNT(*) FROM public.documents')
                    dc = cur.fetchone()[0]
            return { 'statusCode': 200, 'body': json.dumps({'gasable_index': int(gi), 'embeddings': int(em), 'documents': int(dc)}) }

        # Not found
        return { 'statusCode': 404, 'body': json.dumps({'error': 'not found'}) }

    except Exception as e:
        return { 'statusCode': 500, 'body': json.dumps({'error': str(e)}) }


