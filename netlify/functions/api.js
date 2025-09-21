const { Pool } = require('pg');

function getPool() {
  const connStr = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
  if (!connStr) throw new Error('DATABASE_URL/NETLIFY_DATABASE_URL not set');
  return new Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
}

function json(code, obj) {
  return { statusCode: code, headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) };
}

exports.handler = async (event, context) => {
  const rawPath = event.path || '';
  const path = (rawPath.split('/.netlify/functions/api')[1] || '/').replace(/\/+/g, '/');
  const method = event.httpMethod || 'GET';
  const qs = event.queryStringParameters || {};
  const pool = getPool();

  try {
    if (path === '/status') {
      try {
        await pool.query('SELECT 1');
        return json(200, { db: { status: 'ok' } });
      } catch (e) {
        return json(200, { db: { status: 'error', error: String(e) } });
      }
    }

    if (path === '/db_stats') {
      const r1 = await pool.query('SELECT COUNT(*)::int AS c FROM public.gasable_index');
      const r2 = await pool.query('SELECT COUNT(*)::int AS c FROM public.embeddings');
      const r3 = await pool.query('SELECT COUNT(*)::int AS c FROM public.documents');
      return json(200, { gasable_index: r1.rows[0].c, embeddings: r2.rows[0].c, documents: r3.rows[0].c });
    }

    if (path === '/mcp_tools') {
      return json(200, { tools: [] });
    }

    if (path === '/db/schemas') {
      const r = await pool.query("SELECT nspname AS schema FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' ORDER BY 1");
      return json(200, { schemas: r.rows.map(r => r.schema) });
    }

    if (path === '/db/tables') {
      const r = await pool.query(`
        SELECT n.nspname AS schema, c.relname AS table,
               COALESCE(s.n_live_tup, 0)::bigint AS est_rows,
               pg_total_relation_size(c.oid)::bigint AS total_bytes
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_stat_user_tables s ON s.relname = c.relname AND s.schemaname = n.nspname
        WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        ORDER BY n.nspname, c.relname
      `);
      // Optionally compute exact counts for small tables
      const tables = r.rows;
      for (const t of tables) {
        try {
          const rr = await pool.query(`SELECT COUNT(*)::bigint AS c FROM ${t.schema}.${t.table}`);
          t.exact_rows = Number(rr.rows[0].c);
        } catch (_) {}
      }
      return json(200, { tables });
    }

    if (path.endsWith('/columns') && path.startsWith('/db/table/')) {
      const parts = path.split('/');
      const schema = decodeURIComponent(parts[3]);
      const table = decodeURIComponent(parts[4]);
      const cols = await pool.query(`
        SELECT column_name, data_type, is_nullable, ordinal_position
        FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
      `, [schema, table]);
      const idx = await pool.query(`
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
      const r = await pool.query(`SELECT COUNT(*)::bigint AS c FROM ${schema}.${table}`);
      return json(200, { count: Number(r.rows[0].c) });
    }

    if (path.endsWith('/sample') && path.startsWith('/db/table/')) {
      const parts = path.split('/');
      const schema = decodeURIComponent(parts[3]);
      const table = decodeURIComponent(parts[4]);
      const limit = Math.max(1, Math.min(parseInt(qs.limit || '50', 10), 2000));
      const offset = Math.max(0, parseInt(qs.offset || '0', 10));
      const r = await pool.query(`SELECT * FROM ${schema}.${table} OFFSET $1 LIMIT $2`, [offset, limit]);
      return json(200, { columns: r.fields.map(f => f.name), rows: r.rows.map(row => Object.values(row)) });
    }

    if (path === '/processed_files') {
      const r = await pool.query(`
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
      const r = await pool.query(`
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
      const pat = `%${q}%`;
      const r = await pool.query(`
        SELECT node_id, left(text, 2000) AS text
        FROM public.gasable_index
        WHERE text ILIKE $1
        ORDER BY length(text) DESC
        LIMIT 6
      `, [pat]);
      const answer = r.rows.map(x => x.text).join('\n\n');
      return json(200, { answer, answer_html: answer.replace(/\n/g, '<br>'), context_ids: r.rows.map(x => x.node_id) });
    }

    return json(404, { error: 'not found' });
  } catch (e) {
    return json(500, { error: String(e) });
  } finally {
    // let Netlify reuse connections
  }
};


