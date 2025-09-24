import type { Handler } from "@netlify/functions";
import OpenAI from "openai";
import { Client } from "pg";
import { Vector } from "pgvector/pg";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let pgClient: Client | null = null;
async function getPg(): Promise<Client> {
  if (!pgClient) {
    pgClient = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    await pgClient.connect();
  }
  return pgClient;
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


