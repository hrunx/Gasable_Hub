import type { Handler } from "@netlify/functions";
import OpenAI from "openai";
import { Client } from "pg";
import { Vector } from "pgvector/pg";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let pgClient: Client | null = null;
function extractProjectRef(): string {
  const supaUrl = process.env.SUPABASE_URL || "";
  const m1 = supaUrl.match(/https?:\/\/([^.]+)\.supabase\.co/i);
  if (m1) return m1[1];
  const raw = (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "");
  const m2 = raw.match(/@db\.([^.]+)\.supabase\.co/i);
  if (m2) return m2[1];
  return "";
}

function poolerCandidates(base: string): string[] {
  try {
    const url = new URL(base.replace("postgres://", "postgresql://"));
    const username = decodeURIComponent(url.username || "postgres");
    const password = decodeURIComponent(url.password || "");
    const project = extractProjectRef();
    const regions = [
      "us-east-1","us-east-2","us-west-2","eu-central-1","eu-west-1","eu-west-2","eu-north-1",
      "ap-south-1","ap-southeast-1","ap-southeast-2","ap-northeast-1","sa-east-1"
    ];
    return regions.map(r => `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@aws-0-${r}.pooler.supabase.com:6543/postgres?sslmode=require&options=project%3D${project}`);
  } catch {
    return [];
  }
}

async function getPg(): Promise<Client> {
  if (pgClient) return pgClient;
  const primary = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL as string;
  const tryConnect = async (conn: string) => {
    const c = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
    await c.connect();
    await c.query("SELECT 1");
    return c;
  };
  try {
    pgClient = await tryConnect(primary);
  } catch (e: any) {
    if (!/ENOTFOUND|EAI_AGAIN/i.test(String(e))) throw e;
    for (const alt of poolerCandidates(primary)) {
      try { pgClient = await tryConnect(alt); break; } catch(_) {}
    }
    if (!pgClient) throw e;
  }
  return pgClient!;
}

const EMBED_MODEL = process.env.EMBED_MODEL || "text-embedding-3-large";
const EMBED_DIM = Number(process.env.EMBED_DIM || 3072);
const SCHEMA = process.env.PG_SCHEMA || "public";
const TABLE = process.env.PG_TABLE || "gasable_index";
const ANSWER_MODEL = process.env.RERANK_MODEL || process.env.OPENAI_MODEL || "gpt-5-mini";

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "POST only" };
    const { q, k = 12, withAnswer = true } = JSON.parse(event.body || "{}");
    if (!q) return { statusCode: 400, body: "Missing q" };

    // 1) Embed query
    const emb = await openai.embeddings.create({ model: EMBED_MODEL, input: q });
    const vec = emb.data[0].embedding as number[];
    if (vec.length !== EMBED_DIM) {
      console.warn(`Embedding dim mismatch: got ${vec.length}, expected ${EMBED_DIM}`);
    }

    // 2) Vector search on pgvector
    const pg = await getPg();
    const sql = `
      SELECT node_id, text, li_metadata,
             1 - (embedding <=> $1::vector) AS score
      FROM ${SCHEMA}.${TABLE}
      ORDER BY embedding <=> $1::vector
      LIMIT $2
    `;
    const { rows } = await pg.query(sql, [new Vector(vec), k]);

    const hits = rows.map((r: any) => ({
      id: r.node_id,
      score: Number(r.score),
      text: r.text,
      metadata: r.li_metadata
    }));

    if (!withAnswer) {
      return { statusCode: 200, body: JSON.stringify({ query: q, hits }) };
    }

    const context = hits.map((h, i) => `[${i + 1}] ${h.text}`).join("\n\n");
    const messages = [
      { role: "system", content: "Answer concisely and cite sources like [1], [2]. Use only the provided context." },
      { role: "user", content: `Question: ${q}\n\nContext:\n${context}` }
    ] as any;
    const comp = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages,
      temperature: 0
    });

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: q, hits, answer: comp.choices[0].message.content })
    };
  } catch (err: any) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || "error" }) };
  }
};


