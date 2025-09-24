import fs from "fs/promises";
import { Client } from "pg";

function padVector(vec, dim = 3072) {
  const out = Array.isArray(vec) ? vec.slice(0, dim) : [];
  while (out.length < dim) out.push(0);
  return out;
}

function toPgvectorText(vec) {
  return `[${vec.map((x) => (Number.isFinite(x) ? x : 0)).join(",")}]`;
}

async function* chunkArray(iterable, size) {
  let batch = [];
  for (const item of iterable) {
    batch.push(item);
    if (batch.length >= size) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length) yield batch;
}

async function main() {
  const path = process.argv.includes("--path")
    ? process.argv[process.argv.indexOf("--path") + 1]
    : "gasable_index.json";
  const embedDim = process.argv.includes("--embed-dim")
    ? Number(process.argv[process.argv.indexOf("--embed-dim") + 1])
    : Number(process.env.EMBED_DIM || 3072);
  const startIndex = process.argv.includes("--start")
    ? Number(process.argv[process.argv.indexOf("--start") + 1])
    : 0;
  const limit = process.argv.includes("--limit")
    ? Number(process.argv[process.argv.indexOf("--limit") + 1])
    : 0;

  const connStr = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
  if (!connStr) {
    console.error("Missing SUPABASE_DB_URL/DATABASE_URL env");
    process.exit(1);
  }

  const client = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const buf = await fs.readFile(path, { encoding: "utf8" });
    const arr = JSON.parse(buf);
    if (!Array.isArray(arr)) throw new Error("JSON is not an array");

    let count = 0;
    const batchSize = 200;
    const iterable = startIndex > 0 ? arr.slice(startIndex) : arr;
    for await (const batch of chunkArray(iterable, batchSize)) {
      const rows = [];
      for (const obj of batch) {
        const node_id = obj.node_id;
        const text = obj.text ?? null;
        const emb = padVector((obj.embedding || []).map(Number), embedDim);
        const meta = obj.li_metadata || {};
        rows.push([node_id, text, toPgvectorText(emb), JSON.stringify(meta)]);
        count++;
        if (limit && count >= limit) break;
      }
      if (!rows.length) continue;
      const valuesSql = rows
        .map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}::vector, $${i * 4 + 4}::jsonb)`)
        .join(",");
      const flatParams = rows.flat();
      const sql = `
        INSERT INTO public.gasable_index (node_id, text, embedding, li_metadata)
        VALUES ${valuesSql}
        ON CONFLICT (node_id) DO UPDATE SET
          text = EXCLUDED.text,
          embedding = EXCLUDED.embedding,
          li_metadata = COALESCE(public.gasable_index.li_metadata, '{}'::jsonb) || COALESCE(EXCLUDED.li_metadata, '{}'::jsonb)
      `;
      await client.query(sql, flatParams);
      if (limit && count >= limit) break;
    }
    const { rows: [{ cnt }] } = await client.query("SELECT COUNT(*)::int AS cnt FROM public.gasable_index");
    console.log(`rows in gasable_index: ${cnt}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

