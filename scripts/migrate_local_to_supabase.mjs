import { Client } from "pg";

function padVector(vec, dim = 1536) {
  const out = Array.isArray(vec) ? vec.slice(0, dim) : [];
  while (out.length < dim) out.push(0);
  return out;
}

function toPgvectorText(vec) {
  return `[${vec.map((x) => (Number.isFinite(x) ? x : 0)).join(",")}]`;
}

function parseVectorText(text) {
  if (!text) return [];
  const s = String(text).trim();
  const inner = s.startsWith("[") && s.endsWith("]") ? s.slice(1, -1) : s;
  if (!inner) return [];
  return inner.split(",").map((t) => parseFloat(t));
}

async function main() {
  const batchSize = Number(process.env.BATCH_SIZE || 1000);
  const embedDim = Number(process.env.EMBED_DIM || 1536);
  const embedCol = (process.env.PG_EMBED_COL || (embedDim === 1536 ? 'embedding_1536' : 'embedding')).replace(/[^a-zA-Z0-9_]/g, '');
  const sourceEmbeddingExpr = embedCol === 'embedding_1536'
    ? "COALESCE(embedding_1536, embedding)"
    : embedCol;

  // Source (local) connection
  const srcUrl = process.env.LOCAL_DATABASE_URL || `postgresql://${process.env.PG_USER || "hrn"}:${process.env.PG_PASSWORD || "tryharder"}@${process.env.PG_HOST || "localhost"}:${process.env.PG_PORT || 5432}/${process.env.PG_DBNAME || "gasable_db"}`;
  // Destination (Supabase)
  const dstUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
  if (!dstUrl) {
    console.error("Missing SUPABASE_DB_URL/DATABASE_URL for destination");
    process.exit(1);
  }

  const src = new Client({ connectionString: srcUrl });
  const dst = new Client({ connectionString: dstUrl, ssl: { rejectUnauthorized: false } });
  await src.connect();
  await dst.connect();

  try {
    const { rows: [{ cnt: total }] } = await src.query("SELECT COUNT(*)::int AS cnt FROM public.gasable_index");
    console.log(`source rows: ${total}`);

    let offset = 0;
    while (offset < total) {
      const { rows } = await src.query(
        `SELECT node_id, text, ${sourceEmbeddingExpr}::text AS embedding_text, COALESCE(li_metadata, '{}'::jsonb) AS li_metadata
         FROM public.gasable_index
         ORDER BY node_id
         LIMIT $1 OFFSET $2`,
        [batchSize, offset]
      );
      if (!rows.length) break;

      const prepared = rows.map((r) => {
        const arr = parseVectorText(r.embedding_text);
        const padded = padVector(arr, embedDim);
        return [r.node_id, r.text ?? null, toPgvectorText(padded), JSON.stringify(r.li_metadata || {})];
      });

      const valuesSql = prepared
        .map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}::vector, $${i * 4 + 4}::jsonb)`)
        .join(",");
      const flat = prepared.flat();
      const sql = `
        INSERT INTO public.gasable_index (node_id, text, ${embedCol}, li_metadata)
        VALUES ${valuesSql}
        ON CONFLICT (node_id) DO UPDATE SET
          text = EXCLUDED.text,
          ${embedCol} = EXCLUDED.${embedCol},
          li_metadata = COALESCE(public.gasable_index.li_metadata, '{}'::jsonb) || COALESCE(EXCLUDED.li_metadata, '{}'::jsonb)
      `;
      await dst.query(sql, flat);

      offset += rows.length;
      console.log(`migrated ${offset}/${total}`);
    }

    const { rows: [{ cnt: destCount }] } = await dst.query("SELECT COUNT(*)::int AS cnt FROM public.gasable_index");
    console.log(`dest rows: ${destCount}`);
  } finally {
    await src.end();
    await dst.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
