/* Background RAG job: full FastAPI-parity pipeline (expansions → hybrid → RRF → MMR → optional rerank → grounded answer)
   Usage: POST /.netlify/functions/query_job-background  body: { q: string }
   Returns: 202 { id } and writes progress to table public.jobs(id, status, steps, result)
*/
import OpenAI from "openai";
import { Client } from "pg";

type PgClient = {
  connect(): Promise<void>;
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
  end: () => Promise<void>;
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const EMBED_MODEL = process.env.EMBED_MODEL || "text-embedding-3-large";
const EMBED_DIM = Number(process.env.EMBED_DIM || 3072);
const SCHEMA = process.env.PG_SCHEMA || "public";
const TABLE = process.env.PG_TABLE || "gasable_index";
const ANSWER_MODEL = process.env.ANSWER_MODEL || process.env.RERANK_MODEL || process.env.OPENAI_MODEL || "gpt-5-mini";
const RERANK_MODEL = process.env.RERANK_MODEL || process.env.OPENAI_MODEL || "gpt-5-mini";
const TOP_K = Number(process.env.TOP_K || 40);

async function getPg(): Promise<PgClient> {
  const conn = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "";
  const c = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  await c.connect();
  return c as unknown as PgClient;
}

function now() { return Date.now(); }

async function ensureJobsTable(pg: PgClient) {
  await pg.query(`
    CREATE TABLE IF NOT EXISTS public.jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'running',
      steps JSONB NOT NULL DEFAULT '[]'::jsonb,
      result JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

function uuid(): string {
  try { return (globalThis as any).crypto?.randomUUID?.() || require("crypto").randomUUID(); } catch { /* no-op */ }
  const t = Date.now();
  return "job-" + t + "-" + Math.random().toString(36).slice(2, 10);
}

async function pushStep(pg: PgClient, id: string, steps: any[], step: string, meta?: any) {
  const rec = { step, ts: now(), ...(meta || {}) };
  steps.push(rec);
  await pg.query(`UPDATE public.jobs SET steps = $1::jsonb, updated_at = now() WHERE id = $2`, [JSON.stringify(steps), id]);
}

async function embed(text: string): Promise<number[]> {
  const payload: any = { model: EMBED_MODEL, input: text };
  if (Number.isFinite(EMBED_DIM)) payload.dimensions = EMBED_DIM; // allow down-projection if used at ingest
  const e = await openai.embeddings.create(payload);
  const vec = e.data[0].embedding as number[];
  return vec;
}

function rrfFuse(lists: Array<Array<{ id: string; score: number }>>, k = 20) {
  const K = 60;
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((item, idx) => {
      scores.set(item.id, (scores.get(item.id) || 0) + 1 / (K + idx + 1));
    });
  }
  return Array.from(scores.entries()).sort((a,b) => b[1] - a[1]).slice(0, k).map(([id,score]) => ({ id, score }));
}

function simpleMMR(cands: Array<{ id: string; score: number; text: string }>, k = 6, lambda = 0.7) {
  const selected: Array<{ id: string; score: number; text: string }>=[];
  const used = new Set<string>();
  const tok = (t: string) => new Set(String(t||"").split(/\W+/).filter(w=>w.length>2));
  const sim = (a: string, b: string) => {
    const A = tok(a), B = tok(b);
    const inter = Array.from(A).filter(x => B.has(x)).length;
    const denom = Math.sqrt(A.size * B.size) || 1;
    return inter/denom;
  };
  while (selected.length < k && cands.length) {
    let best=-Infinity, bestIdx=-1;
    for (let i=0;i<cands.length;i++) {
      if (used.has(cands[i].id)) continue;
      const rel = cands[i].score;
      let div = 0;
      for (const s of selected) div = Math.max(div, sim(cands[i].text, s.text));
      const val = lambda * rel - (1-lambda) * div;
      if (val > best) { best = val; bestIdx = i; }
    }
    if (bestIdx === -1) break;
    const pick = cands.splice(bestIdx,1)[0];
    used.add(pick.id);
    selected.push(pick);
  }
  return selected;
}

async function handler(event: Request): Promise<Response> {
  if (event.method !== "POST") return new Response("POST only", { status: 405 });
  try {
    const { q } = await event.json().catch(()=>({}));
    const query = String(q || "").trim();
    if (!query) return new Response(JSON.stringify({ error: "Empty query" }), { status: 400, headers: { "content-type": "application/json" } });

    const id = uuid();
    const pg = await getPg();
    await ensureJobsTable(pg);
    await pg.query(`INSERT INTO public.jobs(id, status, steps) VALUES ($1, 'running', '[]'::jsonb)`, [id]);

    // Begin job in background semantics (function itself is a background function)
    const steps: any[] = [];
    await pushStep(pg, id, steps, "received_query", { lang: "en" });

    // Expansions (LLM budgeted)
    const expSys = "You produce only a JSON array of search queries. Include English and Arabic variants if helpful. No text outside JSON.";
    let expansions: string[] = [query];
    try {
      const resp = await openai.chat.completions.create({
        model: RERANK_MODEL,
        messages: [
          { role: "system", content: expSys },
          { role: "user", content: `Original: ${query}\nReturn up to 3 concise search queries as a JSON array.` },
        ]
      });
      const raw = resp.choices[0].message.content || "[]";
      const json = (raw.match(/\[.*\]/s) || [raw])[0];
      const arr = JSON.parse(json);
      for (const v of Array.isArray(arr)?arr:[]) {
        const s = String(v||"").trim();
        if (s && !expansions.includes(s)) expansions.push(s);
        if (expansions.length >= 3) break;
      }
    } catch {}
    await pushStep(pg, id, steps, "expansions", { count: expansions.length });

    // Dense retrieval (parallel)
    const denseLists: Array<Array<{id:string; score:number}>> = [];
    const denseRows: Record<string, { text: string }> = {};
    const tDense0 = now();
    await Promise.all(expansions.map(async (exp) => {
      try {
        const vec = await embed(exp);
        const vecText = `[${vec.map(x=> (Number.isFinite(x)?x:0)).join(',')}]`;
        const { rows } = await pg.query(
          `SELECT node_id, left(COALESCE(text, li_metadata->>'chunk'), 2000) AS text, 1 - (embedding <=> $1::vector) AS score
           FROM ${SCHEMA}.${TABLE}
           ORDER BY embedding <=> $1::vector
           LIMIT 6`, [vecText]
        );
        denseLists.push(rows.map((r:any)=>({ id: r.node_id, score: Number(r.score) })));
        rows.forEach((r:any)=>{ if (!denseRows[r.node_id]) denseRows[r.node_id] = { text: r.text }; });
      } catch {}
    }));
    await pushStep(pg, id, steps, "dense_retrieval", { lists: denseLists.length, ms: now()-tDense0 });

    // Lexical retrieval (parallel ILIKE)
    const lexLists: Array<Array<{id:string; score:number}>> = [];
    const tLex0 = now();
    await Promise.all(expansions.map(async (exp) => {
      const tokens = exp.split(/\s+/).filter(w=>w.length>2).slice(0,6);
      const pats = tokens.map(t=>`%${t}%`);
      const conds = tokens.map((_,i)=>`COALESCE(text, li_metadata->>'chunk') ILIKE $${i+1}`).join(' OR ') || 'TRUE';
      const sql = `SELECT node_id, left(COALESCE(text, li_metadata->>'chunk'), 2000) AS text, length(COALESCE(text, li_metadata->>'chunk')) AS L FROM ${SCHEMA}.${TABLE} WHERE ${conds} ORDER BY L DESC LIMIT 6`;
      try {
        const { rows } = await pg.query(sql, pats);
        lexLists.push(rows.map((r:any,i:number)=>({ id: r.node_id, score: 1/(i+1) })));
        rows.forEach((r:any)=>{ if (!denseRows[r.node_id]) denseRows[r.node_id] = { text: r.text }; });
      } catch {}
    }));
    await pushStep(pg, id, steps, "lex_retrieval", { lists: lexLists.length, ms: now()-tLex0 });

    // Fusion
    const fused = rrfFuse([...denseLists, ...lexLists], 20);
    await pushStep(pg, id, steps, "fusion", { candidates: fused.length });

    // Build candidates and MMR select
    const cands = fused.map(f=>({ id: f.id, score: f.score, text: (denseRows[f.id]?.text || "") as string }));
    const selected = simpleMMR(cands, 8, 0.75);
    await pushStep(pg, id, steps, "selected_context", { count: selected.length });

    // Optional LLM rerank
    let reranked = selected;
    try {
      const snip = (s:string)=> String(s||"").replace(/\s+/g,' ').slice(0,900);
      const passages = selected.map((h,i)=>`[${i}] ${snip(h.text)}`).join("\n\n");
      const resp = await openai.chat.completions.create({
        model: RERANK_MODEL,
        messages: [
          { role: "system", content: "You are a precise reranker. Return a JSON array [{index:int, score:float}] only." },
          { role: "user", content: `Query: ${query}\n\nPassages:\n${passages}` }
        ],
      });
      const raw = resp.choices[0].message.content || "[]";
      const json = (raw.match(/\[.*\]/s) || [raw])[0];
      const arr = JSON.parse(json);
      const mapped = Array.isArray(arr)? arr
        .filter((x:any)=> Number.isFinite(x.index) && x.index>=0 && x.index<selected.length)
        .map((x:any)=> ({ ...selected[x.index], score: Number(x.score||0) })) : selected;
      mapped.sort((a,b)=> b.score-a.score);
      reranked = mapped.slice(0,6);
    } catch {}

    // Answer (grounded, bullet-only)
    const ctx = reranked.map((h,i)=>`[${i+1}] ${h.text}`).join("\n\n");
    let answer = "";
    try {
      const comp = await openai.chat.completions.create({
        model: ANSWER_MODEL,
        messages: [
          { role: "system", content: "Output ONLY plain bullet points ('- ' prefix). 5–10 bullets max. Keep bullets concise. Cite as [1], [2] based on provided indices. If context is missing or irrelevant, output exactly: 'No context available.'" },
          { role: "user", content: `Question: ${query}\n\nContext:\n${ctx}` }
        ]
      });
      answer = comp.choices[0].message.content || "";
    } catch { answer = reranked.map(s=>`- ${s.text}`).join("\n"); }

    const result = {
      query,
      hits: reranked.map(h=> ({ id: h.id, score: h.score })),
      answer,
    };
    await pg.query(`UPDATE public.jobs SET status='done', result=$1::jsonb, steps=$2::jsonb, updated_at=now() WHERE id=$3`, [JSON.stringify(result), JSON.stringify(steps), id]);

    return new Response(JSON.stringify({ id }), { status: 202, headers: { "content-type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { "content-type": "application/json" } });
  }
}

export default handler;


