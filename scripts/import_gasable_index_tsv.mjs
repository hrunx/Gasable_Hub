import fs from 'fs/promises';
import { Client } from 'pg';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { path: 'exports/gasable_index_dump.tsv', batch: 200, start: 0, limit: 0 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--path') out.path = args[++i] || out.path;
    if (a === '--batch') out.batch = Math.max(1, Math.min(parseInt(args[++i] || '200', 10), 1000));
    if (a === '--start') out.start = Math.max(0, parseInt(args[++i] || '0', 10));
    if (a === '--limit') out.limit = Math.max(0, parseInt(args[++i] || '0', 10));
  }
  return out;
}

async function* chunkArray(arr, size) {
  let i = 0;
  while (i < arr.length) {
    yield arr.slice(i, i + size);
    i += size;
  }
}

async function main() {
  const { path, batch, start, limit } = parseArgs();
  const connStr = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
  if (!connStr) {
    console.error('Missing SUPABASE_DB_URL/DATABASE_URL env');
    process.exit(1);
  }
  const client = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const buf = await fs.readFile(path, { encoding: 'utf8' });
    const lines = buf.split(/\r?\n/).filter(Boolean);
    const sliced = lines.slice(start, limit ? start + limit : undefined);
    let processed = 0;
    for await (const group of chunkArray(sliced, batch)) {
      const rows = [];
      for (const line of group) {
        const idx = line.indexOf('\t');
        if (idx <= 0) continue;
        const node_id = line.slice(0, idx);
        const text = line.slice(idx + 1);
        if (!node_id) continue;
        rows.push([node_id, text]);
      }
      if (!rows.length) continue;
      const valuesSql = rows.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(',');
      const flat = rows.flat();
      const sql = `
        INSERT INTO public.gasable_index (node_id, text)
        VALUES ${valuesSql}
        ON CONFLICT (node_id) DO UPDATE SET
          text = EXCLUDED.text
      `;
      await client.query(sql, flat);
      processed += rows.length;
    }
    const { rows: [{ cnt }] } = await client.query('SELECT COUNT(*)::int AS cnt FROM public.gasable_index');
    console.log(`tsv imported/updated: ${processed}, total in gasable_index: ${cnt}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


