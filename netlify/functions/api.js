process.env.NODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED || '0';
process.env.PGSSLMODE = process.env.PGSSLMODE || 'no-verify';
const { Client } = require('pg');

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
      
      // Prefer gasable.com web content first
      const preferDomain = `web://%gasable.com%`;

      // token-based lexical scoring
      const tokens = q.split(/\s+/).map(t => t.trim()).filter(t => t.length >= 2).slice(0, 8);
      const ilikes = tokens.map((_, i) => `CASE WHEN text ILIKE $${i + 1} THEN 1 ELSE 0 END`).join(' + ') || '0';
      const params = tokens.map(t => `%${t}%`);

      // 1) Domain-prioritized search
      let sql = `
        SELECT node_id, left(text, 2000) AS text, (${ilikes}) AS score
        FROM public.gasable_index
        WHERE node_id LIKE $${params.length + 1}
        ORDER BY score DESC, length(text) DESC
        LIMIT 8
      `;
      let r = await db.query(sql, [...params, preferDomain]);

      // 2) If empty, general search
      if (r.rows.length === 0) {
        sql = `
          SELECT node_id, left(text, 2000) AS text, (${ilikes}) AS score
          FROM public.gasable_index
          ORDER BY score DESC, length(text) DESC
          LIMIT 8
        `;
        r = await db.query(sql, params);
      }

      // 3) If still empty, trigram fallback scoped to domain first
      if (r.rows.length === 0) {
        r = await db.query(`
          SELECT node_id, left(text, 2000) AS text
          FROM public.gasable_index
          WHERE node_id LIKE $1 AND text % $2
          ORDER BY similarity(text, $2) DESC
          LIMIT 8
        `, [preferDomain, q]);
      }
      if (r.rows.length === 0) {
        r = await db.query(`
          SELECT node_id, left(text, 2000) AS text
          FROM public.gasable_index
          WHERE text % $1
          ORDER BY similarity(text, $1) DESC
          LIMIT 8
        `, [q]);
      }

      const clean = (t) => {
        if (!t) return '';
        let s = String(t);
        s = s.replace(/<[^>]+>/g, ' ');
        s = s.replace(/https:\s+/g, 'https://').replace(/http:\s+/g, 'http://');
        s = s.replace(/\s{2,}/g, ' ');
        s = s.replace(/\n{3,}/g, '\n\n');
        return s.trim();
      };
      const answer = clean(r.rows.map(x => x.text).join('\n\n'));
      const sources = r.rows.map(x => String(x.node_id || '')
        .replace(/^web:\/\//, '')
        .replace(/^file:\/\//, '')
      );
      return json(200, { answer, answer_html: answer.replace(/\n/g, '<br>'), context_ids: r.rows.map(x => x.node_id), sources });
    }

    return json(404, { error: 'not found' });
  } catch (e) {
    return json(500, { error: String(e) });
  } finally {
    try { if (db) await db.end(); } catch (_) {}
  }
};


