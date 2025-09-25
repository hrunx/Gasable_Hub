/* Background backfill for embedding_1536
Usage: POST /.netlify/functions/backfill_1536-background { limit?: number }
Runs in batches to populate 1536-dim vectors using EMBED_MODEL/EMBED_DIM.
*/
import OpenAI from "openai";
import { Client } from "pg";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMBED_MODEL = process.env.EMBED_MODEL || "text-embedding-3-small";
const EMBED_DIM = Number(process.env.EMBED_DIM || 1536);
const SCHEMA = process.env.PG_SCHEMA || "public";
const TABLE = process.env.PG_TABLE || "gasable_index";

async function getPg() {
  const conn = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "";
  const c = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  await c.connect();
  return c;
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const payload: any = { model: EMBED_MODEL, input: texts };
  if (Number.isFinite(EMBED_DIM)) payload.dimensions = EMBED_DIM;
  const e = await openai.embeddings.create(payload);
  return e.data.map(d => d.embedding as number[]);
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const { limit } = await req.json().catch(() => ({}));
  const batch = Math.max(1, Math.min(Number(limit || 200), 2000));
  const pg = await getPg();
  try {
    const { rows } = await pg.query(
      `SELECT node_id, COALESCE(text, li_metadata->>'chunk') AS txt
       FROM ${SCHEMA}.${TABLE}
       WHERE embedding_1536 IS NULL AND COALESCE(text, li_metadata->>'chunk') IS NOT NULL
       LIMIT $1`, [batch]
    );
    if (!rows.length) {
      return new Response(JSON.stringify({ updated: 0, done: true }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const texts = rows.map((r: any) => String(r.txt || ""));
    const ids = rows.map((r: any) => String(r.node_id));
    const vecs = await embedBatch(texts);
    // Update in a single transaction
    await pg.query("BEGIN");
    for (let i = 0; i < ids.length; i++) {
      const vecText = `[${vecs[i].map((x:number)=> (Number.isFinite(x)?x:0)).join(',')}]`;
      await pg.query(
        `UPDATE ${SCHEMA}.${TABLE} SET embedding_1536 = $1::vector WHERE node_id = $2`,
        [vecText, ids[i]]
      );
    }
    await pg.query("COMMIT");
    return new Response(JSON.stringify({ updated: ids.length, done: false }), { status: 200, headers: { "content-type": "application/json" } });
  } catch (e: any) {
    try { await pg.query("ROLLBACK"); } catch {}
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { "content-type": "application/json" } });
  } finally {
    try { await pg.end(); } catch {}
  }
};
