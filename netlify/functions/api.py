import json
import os
import re
import psycopg2
from rank_bm25 import BM25Okapi
from urllib.parse import urlparse, unquote

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

def _resp(obj: dict, code: int = 200):
    return { 'statusCode': code, 'headers': { 'content-type': 'application/json' }, 'body': json.dumps(obj) }


def handler(event, context):
    # Map multiple endpoints for Netlify Functions API
    raw_path = event.get('path', '') or ''
    # Expected: '/.netlify/functions/api/...'
    path = raw_path.split('/.netlify/functions/api', 1)[-1] or '/'
    http_method = event.get('httpMethod', 'GET')
    qs = event.get('queryStringParameters') or {}

    try:
        # --- RAG Query (lexical) ---
        if path == '/query' and http_method == 'POST':
            body = event.get('body') or '{}'
            data = json.loads(body)
            q = (data.get('q') or '').strip()
            if not q:
                return _resp({'error':'Empty query'}, 400)
            rows = _bm25_search(q, k=int(os.getenv('RAG_TOP_K','6')))
            answer = '\n\n'.join(t for (_id, t, _s) in rows)
            return _resp({'answer': answer, 'answer_html': answer.replace('\n','<br>'), 'context_ids': [i for (i,_,__) in rows]})

        # --- Health/Status ---
        if path == '/status':
            try:
                with _pg() as conn:
                    with conn.cursor() as cur:
                        cur.execute('SELECT 1')
                        cur.fetchone()
                db = {'status':'ok'}
            except Exception as e:
                db = {'status':'error','error':str(e)}
            return _resp({'db': db})

        if path == '/db_stats':
            with _pg() as conn:
                with conn.cursor() as cur:
                    cur.execute('SELECT COUNT(*) FROM public.gasable_index')
                    gi = cur.fetchone()[0]
                    cur.execute('SELECT COUNT(*) FROM public.embeddings')
                    em = cur.fetchone()[0]
                    cur.execute('SELECT COUNT(*) FROM public.documents')
                    dc = cur.fetchone()[0]
            return _resp({'gasable_index': int(gi), 'embeddings': int(em), 'documents': int(dc)})

        # --- MCP tools stub (UI expects an array) ---
        if path == '/mcp_tools':
            return _resp({'tools': []})

        # --- DB Introspection ---
        if path == '/db/schemas':
            with _pg() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        SELECT nspname AS schema
                        FROM pg_namespace
                        WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'
                        ORDER BY 1
                    """)
                    schemas = [r[0] for r in cur.fetchall()]
            return _resp({'schemas': schemas})

        if path == '/db/tables':
            out = []
            with _pg() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
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
                    """)
                    rows = cur.fetchall()
                    out = [
                        { 'schema': r[0], 'table': r[1], 'est_rows': int(r[2]), 'total_bytes': int(r[3]) }
                        for r in rows
                    ]
                    # exact counts (best-effort)
                    for t in out:
                        try:
                            cur.execute(f"SELECT COUNT(*) FROM {t['schema']}.{t['table']}")
                            t['exact_rows'] = int(cur.fetchone()[0])
                        except Exception:
                            pass
            return _resp({'tables': out})

        if path.startswith('/db/table/') and path.endswith('/columns'):
            parts = path.split('/')
            schema, table = unquote(parts[3]), unquote(parts[4])
            with _pg() as conn:
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
                        { 'name': r[0], 'type': r[1], 'nullable': r[2] == 'YES', 'position': int(r[3]) }
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
                    idx = [ { 'name': r[0], 'def': r[1] } for r in cur.fetchall() ]
            return _resp({'columns': cols, 'indexes': idx})

        if path.startswith('/db/table/') and path.endswith('/count'):
            parts = path.split('/')
            schema, table = unquote(parts[3]), unquote(parts[4])
            with _pg() as conn:
                with conn.cursor() as cur:
                    cur.execute(f"SELECT COUNT(*) FROM {schema}.{table}")
                    count = cur.fetchone()[0]
            return _resp({'count': int(count)})

        if path.startswith('/db/table/') and path.endswith('/sample'):
            parts = path.split('/')
            schema, table = unquote(parts[3]), unquote(parts[4])
            limit = max(1, min(int(qs.get('limit') or 50), 2000))
            offset = max(0, int(qs.get('offset') or 0))
            with _pg() as conn:
                with conn.cursor() as cur:
                    cur.execute(f"SELECT * FROM {schema}.{table} OFFSET %s LIMIT %s", (offset, limit))
                    rows = cur.fetchall()
                    columns = [d[0] for d in cur.description] if cur.description else []
            return _resp({'columns': columns, 'rows': [list(r) for r in rows]})

        if path == '/processed_files':
            out = []
            with _pg() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT
                          CASE WHEN position('#' in node_id) > 0 THEN left(node_id, position('#' in node_id)-1) ELSE node_id END AS file,
                          COUNT(*) AS cnt
                        FROM public.gasable_index
                        GROUP BY 1
                        ORDER BY cnt DESC
                        LIMIT 10000
                        """
                    )
                    rows = cur.fetchall()
                    out = [ { 'file': r[0], 'count': int(r[1]) } for r in rows ]
            return _resp({'files': out})

        if path == '/file_entries':
            file = (qs.get('file') or '').strip()
            limit = max(1, min(int(qs.get('limit') or 500), 5000))
            offset = max(0, int(qs.get('offset') or 0))
            full = int(qs.get('full') or 0)
            if not file:
                return _resp({'entries': []})
            like = file + '#%'
            items = []
            with _pg() as conn:
                with conn.cursor() as cur:
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
                    for nid, txt, emb in cur.fetchall():
                        emb_str = emb or ''
                        if not full and emb_str:
                            items.append({'node_id': nid, 'text': txt, 'embedding_preview': emb_str[:256], 'embedding_dim': None})
                        else:
                            items.append({'node_id': nid, 'text': txt, 'embedding': emb_str})
            return _resp({'entries': items})

        # Not found
        return _resp({'error': 'not found'}, 404)

    except Exception as e:
        return _resp({'error': str(e)}, 500)


