// Backfill embedding_1536 for public.gasable_index in batches
// Usage:
//   OPENAI_API_KEY=... DATABASE_URL=... PGSSLMODE=require \
//   node scripts/backfill_1536.mjs --limit 500 --batches 40

import OpenAI from 'openai';
import { Client } from 'pg';

const EMBED_MODEL = process.env.EMBED_MODEL || 'text-embedding-3-small';
const EMBED_DIM = Number(process.env.EMBED_DIM || 1536);
const SCHEMA = process.env.PG_SCHEMA || 'public';
const TABLE = process.env.PG_TABLE || 'gasable_index';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { limit: 200, batches: 10 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--limit') out.limit = Math.max(1, Math.min(parseInt(args[++i] || '200', 10), 2000));
    if (a === '--batches') out.batches = Math.max(1, Math.min(parseInt(args[++i] || '10', 10), 10000));
  }
  return out;
}

async function getPg() {
  const dsn = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!dsn) throw new Error('DATABASE_URL not set');
  const c = new Client({ connectionString: dsn, ssl: { rejectUnauthorized: false } });
  await c.connect();
  return c;
}

async function fetchBatch(pg, limit) {
  const { rows } = await pg.query(
    `SELECT node_id, COALESCE(text, li_metadata->>'chunk') AS txt
     FROM ${SCHEMA}.${TABLE}
     WHERE embedding_1536 IS NULL AND COALESCE(text, li_metadata->>'chunk') IS NOT NULL
     LIMIT $1`, [limit]
  );
  return rows.map(r => ({ id: r.node_id, text: String(r.txt || '') }));
}

async function embedBatch(openai, texts) {
  const payload = { model: EMBED_MODEL, input: texts };
  if (Number.isFinite(EMBED_DIM)) payload.dimensions = EMBED_DIM;
  const e = await openai.embeddings.create(payload);
  return e.data.map(d => d.embedding);
}

async function updateBatch(pg, ids, vecs) {
  await pg.query('BEGIN');
  try {
    for (let i = 0; i < ids.length; i++) {
      const v = vecs[i] || [];
      const vecText = '[' + v.map(x => (Number.isFinite(x) ? x : 0)).join(',') + ']';
      await pg.query(
        `UPDATE ${SCHEMA}.${TABLE} SET embedding_1536 = $1::vector WHERE node_id = $2`,
        [vecText, ids[i]]
      );
    }
    await pg.query('COMMIT');
    return ids.length;
  } catch (e) {
    await pg.query('ROLLBACK');
    throw e;
  }
}

async function main() {
  const { limit, batches } = parseArgs();
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const pg = await getPg();
  let total = 0;
  for (let b = 0; b < batches; b++) {
    const batch = await fetchBatch(pg, limit);
    if (!batch.length) { console.log('done: no more rows'); break; }
    const texts = batch.map(r => r.text.slice(0, 8000));
    const ids = batch.map(r => r.id);
    const vecs = await embedBatch(openai, texts);
    const updated = await updateBatch(pg, ids, vecs);
    total += updated;
    console.log(`batch ${b+1}/${batches}: updated ${updated} (total ${total})`);
  }
  await pg.end();
}

main().catch(e => { console.error('backfill error:', e?.message || e); process.exit(1); });


