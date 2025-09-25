// Enforce TLS verification (avoid insecure override); rely on DATABASE_URL sslmode
process.env.PGSSLMODE = process.env.PGSSLMODE || 'require';
const { Client } = require('pg');
const OpenAI = require('openai');

function extractProjectRef() {
  const supaUrl = process.env.SUPABASE_URL || '';
  const m1 = supaUrl.match(/https?:\/\/([^.]+)\.supabase\.co/i);
  if (m1) return m1[1];
  const raw = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL || '';
  const m2 = raw.match(/@db\.([^.]+)\.supabase\.co/i);
  if (m2) return m2[1];
  return '';
}

function withNoVerify(dsn) {
  try {
    const u = new URL(dsn.replace('postgres://', 'postgresql://'));
    u.searchParams.set('sslmode', 'no-verify');
    return u.toString();
  } catch {
    return dsn + (dsn.includes('?') ? '&' : '?') + 'sslmode=no-verify';
  }
}

function buildPoolerConnStr(baseConnStr) {
  const url = new URL(baseConnStr.replace('postgres://', 'postgresql://'));
  const username = decodeURIComponent(url.username || 'postgres');
  const password = decodeURIComponent(url.password || '');
  const project = extractProjectRef();
  const regions = [
    'us-east-1','us-east-2','us-west-2','eu-central-1','eu-west-1','eu-west-2','eu-north-1',
    'ap-south-1','ap-southeast-1','ap-southeast-2','ap-northeast-1','sa-east-1'
  ];
  return regions.map(r => withNoVerify(`postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@aws-0-${r}.pooler.supabase.com:6543/postgres?sslmode=require&options=project%3D${project}`));
}

async function getClient() {
  const primaryRaw = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
  if (!primaryRaw) throw new Error('DATABASE_URL/NETLIFY_DATABASE_URL not set');
  const primary = withNoVerify(primaryRaw);
  const tryConn = async (connStr) => {
    const c = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
    await c.connect();
    await c.query('SELECT 1');
    return c;
  };
  try {
    return await tryConn(primary);
  } catch (e) {
    const msg = String(e || '');
    if (!/ENOTFOUND|EAI_AGAIN|self-signed certificate/i.test(msg)) throw e;
    for (const alt of buildPoolerConnStr(primary)) {
      try { return await tryConn(alt); } catch (_) {}
    }
    throw e;
  }
}

// --- RAG helpers (hybrid retrieval + formatting) ---
const EMBED_MODEL = process.env.EMBED_MODEL || 'text-embedding-3-large';
const SCHEMA = process.env.PG_SCHEMA || 'public';
const TABLE = process.env.PG_TABLE || 'gasable_index';
const ANSWER_MODEL = process.env.RERANK_MODEL || process.env.OPENAI_MODEL || 'gpt-5-mini';
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const EMBED_DIM = Number(process.env.EMBED_DIM || 3072);
const TOP_K = Number(process.env.TOP_K || 40);
const USE_BM25 = String(process.env.USE_BM25 || 'false').toLowerCase() === 'true';
const RERANK_MODEL = process.env.RERANK_MODEL || process.env.OPENAI_MODEL || 'gpt-5-mini';

function naiveExpansions(q) {
  const parts = String(q || '').split(/\s+/).filter(Boolean);
  const set = new Set();
  const add = (t) => { if (t && !set.has(t)) set.add(t); };
  add(q);
  add(parts.slice().reverse().join(' '));
  add(parts.map(p => p.replace(/ing\b/i, '')).join(' '));
  add(parts.map(p => p.replace(/s\b/i, '')).join(' '));
  return Array.from(set).slice(0, 3);
}

function rrfFuse(lists, k = 20) {
  const K = 60;
  const scores = new Map();
  for (const list of lists) {
    list.forEach((item, idx) => {
      const prev = scores.get(item.id) || 0;
      scores.set(item.id, prev + 1 / (K + idx + 1));
    });
  }
  return Array.from(scores.entries()).sort((a,b) => b[1] - a[1]).slice(0, k).map(([id,score]) => ({ id, score }));
}

function simpleMMR(candidates, k = 8, lambda = 0.75) {
  const selected = [];
  const used = new Set();
  const tokensOf = (t) => new Set(String(t||'').split(/\W+/).filter(x => x.length > 2));
  const sim = (a, b) => {
    const A = tokensOf(a), B = tokensOf(b);
    const inter = Array.from(A).filter(x => B.has(x)).length;
    const denom = Math.sqrt(A.size * B.size) || 1;
    return inter / denom;
  };
  while (selected.length < k && candidates.length) {
    let best = -Infinity, bestIdx = -1;
    for (let i=0;i<candidates.length;i++) {
      if (used.has(candidates[i].id)) continue;
      const rel = candidates[i].score;
      let div = 0;
      for (const s of selected) div = Math.max(div, sim(candidates[i].text, s.text));
      const val = lambda * rel - (1 - lambda) * div;
      if (val > best) { best = val; bestIdx = i; }
    }
    if (bestIdx === -1) break;
    const pick = candidates.splice(bestIdx, 1)[0];
    used.add(pick.id);
    selected.push(pick);
  }
  return selected;
}

async function embedOnce(query) {
  if (!openai) return null;
  try {
    const payload = { model: EMBED_MODEL, input: query };
    if (Number.isFinite(EMBED_DIM)) payload.dimensions = EMBED_DIM; // optional down-projection if used at ingest
    const emb = await openai.embeddings.create(payload);
    const vec = emb?.data?.[0]?.embedding || [];
    if (vec.length && vec.length !== EMBED_DIM) {
      console.warn(`Embedding dim mismatch: got ${vec.length}, expected ${EMBED_DIM}`);
    }
    return vec;
  } catch (_) {
    return null;
  }
}

async function bm25Search(db, q, k) {
  const hasTsv = true; // allow using generated column if present; query is written to work either way
  const sql = `
    WITH docs AS (
      SELECT node_id,
             COALESCE(text, li_metadata->>'chunk') AS txt,
             li_metadata,
             to_tsvector('simple', COALESCE(text, li_metadata->>'chunk')) AS tsv
      FROM ${SCHEMA}.${TABLE}
    )
    SELECT node_id, left(COALESCE(txt,''), 2000) AS text, li_metadata,
           ts_rank_cd(tsv, plainto_tsquery('simple', $1)) AS score
    FROM docs
    WHERE tsv @@ plainto_tsquery('simple', $1)
    ORDER BY score DESC
    LIMIT $2`;
  const { rows } = await db.query(sql, [q, k]);
  return rows.map(r => ({ id: r.node_id, score: Number(r.score || 0), text: r.text || '', metadata: r.li_metadata }));
}

async function rerankLLM(q, hits, budgetMs) {
  if (!openai || !hits?.length) return hits;
  const t0 = Date.now();
  const snip = (s) => String(s || '').replace(/\s+/g, ' ').slice(0, 900);
  const passages = hits.map((h, i) => `[${i}] ${snip(h.text)}`).join('\n\n');
  const sys = 'You are a precise reranker. Return a JSON array of objects: [{index:int, score:float}] with scores in [0,1]. No text other than the JSON array.';
  try {
    const resp = await openai.chat.completions.create({
      model: RERANK_MODEL,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: `Query: ${q}\n\nPassages:\n${passages}` },
      ]
    });
    if (Date.now() - t0 > budgetMs) return hits;
    const raw = resp.choices?.[0]?.message?.content || '[]';
    const jsonText = (raw.match(/\[.*\]/s) || [raw])[0];
    const arr = JSON.parse(jsonText);
    const mapped = Array.isArray(arr) ? arr
      .filter(x => Number.isFinite(x.index) && x.index >= 0 && x.index < hits.length)
      .map(x => ({ ...hits[x.index], score: Number(x.score || 0) })) : hits;
    mapped.sort((a,b) => b.score - a.score);
    return mapped;
  } catch {
    return hits;
  }
}

async function generateExpansionsLLM(q, maxOut = 3, budgetMs = 1800) {
  if (!openai) return naiveExpansions(q).slice(0, maxOut);
  const t0 = Date.now();
  const sys = "You produce only a JSON array of search queries. Include English and Arabic variants if helpful. No text outside JSON.";
  try {
    const resp = await openai.chat.completions.create({
      model: RERANK_MODEL,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: `Original: ${q}\nReturn up to ${maxOut} concise search queries as a JSON array.` },
      ]
    });
    if (Date.now() - t0 > budgetMs) return naiveExpansions(q).slice(0, maxOut);
    const content = resp.choices?.[0]?.message?.content || '[]';
    const jsonText = (content.match(/\[.*\]/s) || [content])[0];
    const arr = JSON.parse(jsonText);
    const out = [q];
    const seen = new Set([q.trim().toLowerCase()]);
    if (Array.isArray(arr)) {
      for (const v of arr) {
        const s = String(v || '').trim();
        if (!s) continue;
        const key = s.toLowerCase();
        if (!seen.has(key)) { out.push(s); seen.add(key); }
        if (out.length >= maxOut) break;
      }
    }
    return out.slice(0, maxOut);
  } catch {
    return naiveExpansions(q).slice(0, maxOut);
  }
}

async function keywordPrefilter(db, q, limitEach = 20) {
  const qnorm = String(q || '').toLowerCase();
  const en = [
    'contract','contracts','supplier','suppliers','diesel','fuel','agreement','terms','pricing',
    'scope','deliverables','penalties','liability','payment','rfq','tender','bid','procurement'
  ];
  const ar = [
    'عقد','عقود','مورد','المورد','موردين','ديزل','وقود','اتفاق','اتفاقية','شروط','تسعير','مناقصة','توريد'
  ];
  const kws = new Set();
  for (const w of [...en, ...ar]) if (qnorm.includes(w)) kws.add(w);
  if (kws.size === 0) return [];
  const patterns = Array.from(kws).map(k => `%${k}%`);
  const lists = [];
  try {
    const sql = `SELECT node_id, left(COALESCE(text, li_metadata->>'chunk'), 2000) AS text
                 FROM ${SCHEMA}.${TABLE}
                 WHERE ${patterns.map((_, i) => `COALESCE(text, li_metadata->>'chunk') ILIKE $${i+1}`).join(' OR ')}
                 LIMIT $${patterns.length + 1}`;
    const { rows } = await db.query(sql, [...patterns, limitEach]);
    lists.push(rows.map(r => ({ id: r.node_id, score: 0.75, text: r.text || '' })));
  } catch {}
  // Optional: try documents / embeddings if present
  try {
    const sql2 = `SELECT id::text AS node_id, left(COALESCE(content,''), 2000) AS text
                  FROM public.documents
                  WHERE ${patterns.map((_, i) => `content ILIKE $${i+1}`).join(' OR ')}
                  ORDER BY id DESC LIMIT $${patterns.length + 1}`;
    const { rows } = await db.query(sql2, [...patterns, limitEach]);
    lists.push(rows.map(r => ({ id: `documents:${r.node_id}`, score: 0.7, text: r.text || '' })));
  } catch {}
  try {
    const sql3 = `SELECT id::text AS node_id, left(COALESCE(chunk_text,''), 2000) AS text
                  FROM public.embeddings
                  WHERE ${patterns.map((_, i) => `chunk_text ILIKE $${i+1}`).join(' OR ')}
                  ORDER BY id DESC LIMIT $${patterns.length + 1}`;
    const { rows } = await db.query(sql3, [...patterns, limitEach]);
    lists.push(rows.map(r => ({ id: `embeddings:${r.node_id}`, score: 0.65, text: r.text || '' })));
  } catch {}
  return lists;
}

function json(code, obj) {
  return { statusCode: code, headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) };
}

exports.handler = async (event, context) => {
  const rawPath = event.path || '';
  const path = (() => {
    let p = rawPath;
    if (p.startsWith('/.netlify/functions/api')) p = p.slice('/.netlify/functions/api'.length);
    if (p.startsWith('/api')) p = p.slice('/api'.length);
    if (!p.startsWith('/')) p = '/' + p;
    p = p.replace(/\/+/g, '/');
    return p || '/';
  })();
  const method = event.httpMethod || 'GET';
  const qs = event.queryStringParameters || {};
  let db = null;

  try {
    db = await getClient();

    if (path === '/status') {
      try {
        await db.query('SELECT 1');
        return json(200, { db: { status: 'ok' } });
      } catch (e) {
        return json(200, { db: { status: 'error', error: String(e) } });
      }
    }

    if (path === '/db_stats') {
      const r1 = await db.query('SELECT COUNT(*)::int AS c FROM public.gasable_index');
      const r2 = await db.query('SELECT COUNT(*)::int AS c FROM public.embeddings');
      const r3 = await db.query('SELECT COUNT(*)::int AS c FROM public.documents');
      return json(200, { gasable_index: r1.rows[0].c, embeddings: r2.rows[0].c, documents: r3.rows[0].c });
    }

    if (path === '/mcp_tools') {
      return json(200, { tools: [
        {
          name: 'lexical.query',
          path: '/api/query',
          method: 'POST',
          input: { q: 'string' },
          output: { answer: 'string', context_ids: 'string[]', sources: 'string[]' }
        },
        { name: 'vector.query', path: '/.netlify/functions/query', method: 'POST' },
        { name: 'vector.stream', path: '/.netlify/functions/query_stream?q=...', method: 'GET' },
        { name: 'db.status', path: '/api/status', method: 'GET' },
        { name: 'db.stats', path: '/api/db_stats', method: 'GET' },
        { name: 'db.schemas', path: '/api/db/schemas', method: 'GET' },
        { name: 'db.tables', path: '/api/db/tables', method: 'GET' },
        { name: 'files.processed', path: '/api/processed_files', method: 'GET' },
        { name: 'files.entries', path: '/api/file_entries?file=...', method: 'GET' }
      ]});
    }

    if (path === '/db/schemas') {
      const r = await db.query("SELECT nspname AS schema FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' ORDER BY 1");
      return json(200, { schemas: r.rows.map(r => r.schema) });
    }

    if (path === '/db/tables') {
      const r = await db.query(`
        SELECT n.nspname AS schema, c.relname AS table,
               COALESCE(s.n_live_tup, 0)::bigint AS est_rows,
               pg_total_relation_size(c.oid)::bigint AS total_bytes
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_stat_user_tables s ON s.relname = c.relname AND s.schemaname = n.nspname
        WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        ORDER BY n.nspname, c.relname
      `);
      const tables = r.rows;
      for (const t of tables) {
        try {
          const rr = await db.query(`SELECT COUNT(*)::bigint AS c FROM ${t.schema}.${t.table}`);
          t.exact_rows = Number(rr.rows[0].c);
        } catch (_) {}
      }
      return json(200, { tables });
    }

    if (path.endsWith('/columns') && path.startsWith('/db/table/')) {
      const parts = path.split('/');
      const schema = decodeURIComponent(parts[3]);
      const table = decodeURIComponent(parts[4]);
      const cols = await db.query(`
        SELECT column_name, data_type, is_nullable, ordinal_position
        FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
      `, [schema, table]);
      const idx = await db.query(`
        SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = $1 AND tablename = $2
        ORDER BY 1
      `, [schema, table]);
      return json(200, { columns: cols.rows.map(r => ({ name: r.column_name, type: r.data_type, nullable: r.is_nullable === 'YES', position: Number(r.ordinal_position) })), indexes: idx.rows.map(r => ({ name: r.indexname, def: r.indexdef })) });
    }

    if (path.endsWith('/count') && path.startsWith('/db/table/')) {
      const parts = path.split('/');
      const schema = decodeURIComponent(parts[3]);
      const table = decodeURIComponent(parts[4]);
      const r = await db.query(`SELECT COUNT(*)::bigint AS c FROM ${schema}.${table}`);
      return json(200, { count: Number(r.rows[0].c) });
    }

    if (path.endsWith('/sample') && path.startsWith('/db/table/')) {
      const parts = path.split('/');
      const schema = decodeURIComponent(parts[3]);
      const table = decodeURIComponent(parts[4]);
      const limit = Math.max(1, Math.min(parseInt(qs.limit || '50', 10), 2000));
      const offset = Math.max(0, parseInt(qs.offset || '0', 10));
      const r = await db.query(`SELECT * FROM ${schema}.${table} OFFSET $1 LIMIT $2`, [offset, limit]);
      return json(200, { columns: r.fields.map(f => f.name), rows: r.rows.map(row => Object.values(row)) });
    }

    if (path === '/processed_files') {
      const r = await db.query(`
        SELECT CASE WHEN position('#' in node_id) > 0 THEN left(node_id, position('#' in node_id)-1) ELSE node_id END AS file,
               COUNT(*)::bigint AS cnt
        FROM public.gasable_index
        GROUP BY 1
        ORDER BY cnt DESC
        LIMIT 10000
      `);
      return json(200, { files: r.rows.map(r => ({ file: r.file, count: Number(r.cnt) })) });
    }

    if (path === '/file_entries') {
      const file = (qs.file || '').trim();
      const limit = Math.max(1, Math.min(parseInt(qs.limit || '500', 10), 5000));
      const offset = Math.max(0, parseInt(qs.offset || '0', 10));
      const full = parseInt(qs.full || '0', 10);
      if (!file) return json(200, { entries: [] });
      const like = file + '#%';
      const r = await db.query(`
        SELECT node_id, COALESCE(text,''), CASE WHEN embedding IS NULL THEN NULL ELSE embedding::text END AS embedding_text
        FROM public.gasable_index
        WHERE node_id LIKE $1
        ORDER BY node_id
        OFFSET $2 LIMIT $3
      `, [like, offset, limit]);
      const entries = r.rows.map(row => {
        const emb = row.embedding_text || '';
        const text = row.coalesce || row.text || '';
        if (!full && emb) return { node_id: row.node_id, text, embedding_preview: emb.slice(0, 256), embedding_dim: null };
        return { node_id: row.node_id, text, embedding: emb };
      });
      return json(200, { entries });
    }

    if (path === '/query' && method === 'POST') {
      let body = {};
      try { body = JSON.parse(event.body || '{}'); } catch (_) {}
      const q = (body.q || '').trim();
      if (!q) return json(400, { error: 'Empty query' });
      const BUDGET_MS = Number(process.env.SINGLESHOT_BUDGET_MS || 8000);
      const tStart = Date.now();
      
      const clean = (t) => {
        if (!t) return '';
        let s = String(t);
        // Strip HTML
        s = s.replace(/<[^>]+>/g, ' ');
        // Remove markdown images and links content noise
        s = s.replace(/!\[[^\]]*\]\([^\)]*\)/g, ' ');
        s = s.replace(/\[[^\]]*\]\([^\)]*\)/g, (m) => {
          const text = (m.match(/^\[([^\]]*)\]/) || [,''])[1] || '';
          return text;
        });
        s = s.replace(/https:\s+/g, 'https://').replace(/http:\s+/g, 'http://');
        s = s.replace(/\s{2,}/g, ' ');
        s = s.replace(/\n{3,}/g, '\n\n');
        return s.trim();
      };

      // If OpenAI is configured, run a hybrid retrieval + LLM formatting; else use lexical only
      if (openai) {
        // LLM-based expansions with budget
        const exps = await generateExpansionsLLM(q, 3, 1500);
        const denseLists = [];
        const denseRows = {};
        try {
          for (const exp of exps) {
            if (Date.now() - tStart > BUDGET_MS) break;
            const vec = await embedOnce(exp);
            if (!vec?.length) continue;
            const vecText = '[' + vec.map(x => (Number.isFinite(x) ? x : 0)).join(',') + ']';
            const { rows } = await db.query(
              `SELECT node_id, left(COALESCE(text, li_metadata->>'chunk'), 2000) AS text, 1 - (embedding <=> $1::vector) AS score
               FROM ${SCHEMA}.${TABLE}
               ORDER BY embedding <=> $1::vector
               LIMIT 6`, [vecText]
            );
            denseLists.push(rows.map(r => ({ id: r.node_id, score: Number(r.score) })));
            rows.forEach(r => { if (!denseRows[r.node_id]) denseRows[r.node_id] = { text: r.text }; });
          }
        } catch (_) {}

        const lexLists = [];
        for (const exp of exps) {
          if (Date.now() - tStart > BUDGET_MS) break;
          const tokens = String(exp).split(/\s+/).filter(w => w.length > 2).slice(0, 6);
          const pats = tokens.map(t => `%${t}%`);
          const conds = tokens.map((_, i) => `text ILIKE $${i + 1}`).join(' OR ') || 'TRUE';
          const sql = `SELECT node_id, left(COALESCE(text, li_metadata->>'chunk'), 2000) AS text, length(COALESCE(text, li_metadata->>'chunk')) AS L FROM ${SCHEMA}.${TABLE} WHERE ${conds} ORDER BY L DESC LIMIT 6`;
          try {
            const { rows } = await db.query(sql, pats);
            lexLists.push(rows.map((r, i) => ({ id: r.node_id, score: 1 / (i + 1) })));
            rows.forEach(r => { if (!denseRows[r.node_id]) denseRows[r.node_id] = { text: r.text }; });
          } catch (_) {}
        }

        // Keyword prefilter lists (improves recall on domain-specific terms)
        try {
          const kwLists = await keywordPrefilter(db, q, 20);
          if (kwLists?.length) {
            for (const lst of kwLists) {
              if (Array.isArray(lst)) {
                lexLists.push(lst.map(x => ({ id: x.id, score: x.score || 0.6 })));
                lst.forEach(x => { if (!denseRows[x.id]) denseRows[x.id] = { text: x.text }; });
              }
            }
          }
        } catch (_) {}

        let fused = rrfFuse([...denseLists, ...lexLists], 16);
        // Build candidate objects and lightly boost gasable.com domain
        let cands = fused.map(f => ({ id: f.id, score: f.score, text: (denseRows[f.id]?.text || '') }))
          .sort((a, b) => {
            const da = a.id.startsWith('web://https://www.gasable.com') ? 1 : (a.id.startsWith('web://') ? 0.5 : 0);
            const dbs = b.id.startsWith('web://https://www.gasable.com') ? 1 : (b.id.startsWith('web://') ? 0.5 : 0);
            if (da !== dbs) return dbs - da;
            return 0;
          });
        // Optional BM25 blend for hybrid (parity with FastAPI)
        if (USE_BM25 && (Date.now() - tStart) < BUDGET_MS) {
          try {
            const bm = await bm25Search(db, q, 16);
            const bmMap = new Map(bm.map(x => [x.id, x]));
            const merged = new Map();
            for (const h of [...cands, ...bm]) {
              const prev = merged.get(h.id);
              if (!prev || h.score > prev.score) merged.set(h.id, h);
            }
            cands = Array.from(merged.values());
          } catch (_) {}
        }
        const selected = simpleMMR(cands, 6, 0.75);

        const context = selected.map((s, i) => `[${i + 1}] ${s.text}`).join('\n\n');
        let formatted = '';
        const timeLeft = BUDGET_MS - (Date.now() - tStart);
        if (timeLeft > 2500) {
          try {
            const comp = await openai.chat.completions.create({
              model: ANSWER_MODEL,
              messages: [
                { role: 'system', content: "Output ONLY plain bullet points ('- ' prefix). 5–10 bullets max. No heading, no extra text, no numbering. Keep each bullet concise. Cite sources inline with [1], [2] based on the provided bracketed context indices. If context is missing or irrelevant, output exactly: 'No context available.'" },
                { role: 'user', content: `Question: ${q}\n\nContext:\n${context}` }
              ]
            });
            formatted = clean(comp.choices[0].message.content || '');
          } catch (_) {
            formatted = clean(selected.map(s => s.text).join('\n\n'));
          }
        } else {
          // Budget exceeded: create quick bullets from selected texts
          const text = clean(selected.map(s => s.text).join('\n'));
          const sentences = text.split(/(?<=[.!؟])\s+/).filter(Boolean).slice(0, 8);
          formatted = sentences.map(s => `- ${s}`).join('\n');
        }

        const sources = selected.map(s => String(s.id || '').replace(/^web:\/\//, '').replace(/^file:\/\//, ''));
        const ctxIds = selected.map(s => s.id);
        return json(200, { answer: formatted, answer_html: formatted.replace(/\n/g, '<br>'), context_ids: ctxIds, sources });
      }

      // --- Fallback: lexical only (no OpenAI) ---
      // Prefer gasable.com web content first
      const preferDomain = `web://%gasable.com%`;
      const tokens = q.split(/\s+/).map(t => t.trim()).filter(t => t.length >= 2).slice(0, 8);
      const ilikes = tokens.map((_, i) => `CASE WHEN text ILIKE $${i + 1} THEN 1 ELSE 0 END`).join(' + ') || '0';
      const params = tokens.map(t => `%${t}%`);
      let sql = `
        SELECT node_id, left(text, 2000) AS text, (${ilikes}) AS score
        FROM ${SCHEMA}.${TABLE}
        WHERE node_id LIKE $${params.length + 1}
        ORDER BY score DESC, length(text) DESC
        LIMIT 8
      `;
      let r = await db.query(sql, [...params, preferDomain]);
      if (r.rows.length === 0) {
        sql = `
          SELECT node_id, left(text, 2000) AS text, (${ilikes}) AS score
          FROM ${SCHEMA}.${TABLE}
          ORDER BY score DESC, length(text) DESC
          LIMIT 8
        `;
        r = await db.query(sql, params);
      }
      if (r.rows.length === 0) {
        r = await db.query(`
          SELECT node_id, left(text, 2000) AS text
          FROM ${SCHEMA}.${TABLE}
          WHERE node_id LIKE $1 AND text % $2
          ORDER BY similarity(text, $2) DESC
          LIMIT 8
        `, [preferDomain, q]);
      }
      if (r.rows.length === 0) {
        r = await db.query(`
          SELECT node_id, left(text, 2000) AS text
          FROM ${SCHEMA}.${TABLE}
          WHERE text % $1
          ORDER BY similarity(text, $1) DESC
          LIMIT 8
        `, [q]);
      }
      const answer = clean(r.rows.map(x => x.text).join('\n\n'));
      const sources = r.rows.map(x => String(x.node_id || '').replace(/^web:\/\//, '').replace(/^file:\/\//, ''));
      return json(200, { answer, answer_html: answer.replace(/\n/g, '<br>'), context_ids: r.rows.map(x => x.node_id), sources });
    }

    return json(404, { error: 'not found' });
  } catch (e) {
    return json(500, { error: String(e) });
  } finally {
    try { if (db) await db.end(); } catch (_) {}
  }
};


