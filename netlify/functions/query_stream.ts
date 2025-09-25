/* Streaming RAG with SSE: expansions → dense + lexical → RRF fusion → MMR → final */
import OpenAI from "openai";
import { Client } from "pg";

type PgClient = {
  connect(): Promise<void>;
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
  end: () => Promise<void>;
};
// Avoid pgvector import issues by passing vector text directly

// Use default TLS verification; rely on proper DATABASE_URL SSL params
(process as any).env.PGSSLMODE = (process as any).env.PGSSLMODE || "require";

const EMBED_MODEL = process.env.EMBED_MODEL || "text-embedding-3-large";
const EMBED_DIM = Number(process.env.EMBED_DIM || 3072);
const SCHEMA = process.env.PG_SCHEMA || "public";
const TABLE = process.env.PG_TABLE || "gasable_index";
const ANSWER_MODEL = process.env.RERANK_MODEL || process.env.OPENAI_MODEL || "gpt-5-mini";
const STREAM_BUDGET_MS = Number((process as any).env.STREAM_BUDGET_MS || 8000);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function extractProjectRef(): string {
  const supaUrl = process.env.SUPABASE_URL || "";
  const m1 = supaUrl.match(/https?:\/\/([^.]+)\.supabase\.co/i);
  if (m1) return m1[1];
  const raw = (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "");
  const m2 = raw.match(/@db\.([^.]+)\.supabase\.co/i);
  if (m2) return m2[1];
  return "";
}

function withNoVerify(dsn: string): string {
  try {
    const u = new URL(dsn.replace("postgres://", "postgresql://"));
    u.searchParams.set("sslmode", "no-verify");
    return u.toString();
  } catch {
    return dsn + (dsn.includes("?") ? "&" : "?") + "sslmode=no-verify";
  }
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
    return regions.map(r => `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@aws-0-${r}.pooler.supabase.com:6543/postgres?sslmode=no-verify&options=project%3D${project}`);
  } catch {
    return [];
  }
}

async function getPg(): Promise<PgClient> {
  const primary = withNoVerify(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "");
  const tryConnect = async (conn: string) => {
    const c = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
    await c.connect();
    await c.query("SELECT 1");
    return c;
  };
  try {
    return await tryConnect(primary);
  } catch (e: any) {
    if (!/ENOTFOUND|EAI_AGAIN|self-signed certificate/i.test(String(e))) throw e;
    for (const alt of poolerCandidates(primary)) {
      try { return await tryConnect(alt); } catch(_) {}
    }
    throw e;
  }
}

function sse(controller: ReadableStreamDefaultController, event: string, payload: any) {
  const line = `event: ${event}\n` + `data: ${JSON.stringify(payload)}\n\n`;
  controller.enqueue(new TextEncoder().encode(line));
}

function nowMs() { return Date.now(); }

function naiveExpansions(q: string): string[] {
  const parts = q.split(/\s+/).filter(Boolean);
  const uniq = new Set<string>();
  const add = (t: string) => { if (t && !uniq.has(t)) uniq.add(t); };
  add(q);
  add(parts.reverse().join(" "));
  add(parts.map(p => p.replace(/ing\b/i, "")).join(" "));
  add(parts.map(p => p.replace(/s\b/i, "")).join(" "));
  add(parts.map(p => p.length > 6 ? p.slice(0, 6) : p).join(" "));
  return Array.from(uniq).slice(0, 3);
}

function rrfFuse(lists: Array<Array<{ id: string; score: number }>>, k = 8) {
  const K = 60;
  const scores = new Map<string, number>();
  lists.forEach(list => {
    list.forEach((item, idx) => {
      const prev = scores.get(item.id) || 0;
      scores.set(item.id, prev + 1 / (K + idx + 1));
    });
  });
  const fused = Array.from(scores.entries()).sort((a,b) => b[1] - a[1]).slice(0, k);
  return fused.map(([id,score]) => ({ id, score }));
}

function simpleMMR(candidates: Array<{ id: string; score: number; text: string }>, k = 5, lambda = 0.7) {
  const selected: Array<{ id: string; score: number; text: string }> = [];
  const used = new Set<string>();
  const sim = (a: string, b: string) => {
    const sa = new Set(a.split(/\W+/).filter(t => t.length > 2));
    const sb = new Set(b.split(/\W+/).filter(t => t.length > 2));
    const inter = Array.from(sa).filter(x => sb.has(x)).length;
    const denom = Math.sqrt(sa.size * sb.size) || 1;
    return inter / denom;
  };
  while (selected.length < k && candidates.length) {
    let best = -Infinity, bestIdx = -1;
    for (let i=0;i<candidates.length;i++) {
      if (used.has(candidates[i].id)) continue;
      const rel = candidates[i].score;
      let div = 0;
      for (const s of selected) div = Math.max(div, sim(candidates[i].text, s.text));
      const val = lambda * rel - (1 - lambda) * div;
      if (val > best) { best = val; bestIdx = i; }
    }
    if (bestIdx === -1) break;
    const pick = candidates.splice(bestIdx, 1)[0];
    used.add(pick.id);
    selected.push(pick);
  }
  return selected;
}

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) return new Response("Missing q", { status: 400 });

  const stream = new ReadableStream({
    start: async (controller) => {
      try {
        const tStart = nowMs();
        sse(controller, "step", { step: "received_query", lang: "en" });
        const exps = naiveExpansions(q);
        sse(controller, "step", { step: "expansions", count: exps.length });

        const pg = await getPg();

        // Dense retrieval over expansions
        const t0 = nowMs();
        const denseLists: Array<Array<{ id: string; score: number }>> = [];
        const denseRows: Record<string, { text: string }> = {};
        for (const exp of exps) {
          try {
            const emb = await openai.embeddings.create({ model: EMBED_MODEL, input: exp });
            const vec = emb.data[0].embedding as number[];
            const vecText = `[${vec.map((x:number)=> (Number.isFinite(x)?x:0)).join(',')}]`;
            const { rows } = await pg.query(
              `SELECT node_id, text, 1 - (embedding <=> $1::vector) AS score
               FROM ${SCHEMA}.${TABLE}
               ORDER BY embedding <=> $1::vector
               LIMIT 8`, [vecText]
            );
            denseLists.push(rows.map((r: any, i: number) => ({ id: r.node_id, score: Number(r.score) })));
            rows.forEach((r: any) => { if (!denseRows[r.node_id]) denseRows[r.node_id] = { text: r.text }; });
          } catch (_) {}
        }
        const t1 = nowMs();
        sse(controller, "step", { step: "dense_retrieval", lists: denseLists.length, ms: t1 - t0 });

        // Lexical retrieval
        const t2 = nowMs();
        const lexLists: Array<Array<{ id: string; score: number }>> = [];
        for (const exp of exps) {
          const tokens = exp.split(/\s+/).filter(w => w.length > 2).slice(0, 6);
          const pats = tokens.map(t => `%${t}%`);
          const conds = tokens.map((_, i) => `text ILIKE $${i + 1}`).join(" OR ") || "TRUE";
          const sql = `SELECT node_id, left(text, 2000) AS text, length(text) AS L FROM ${SCHEMA}.${TABLE} WHERE ${conds} ORDER BY L DESC LIMIT 8`;
          const { rows } = await pg.query(sql, pats);
          lexLists.push(rows.map((r: any, i: number) => ({ id: r.node_id, score: 1 / (i + 1) })));
          rows.forEach((r: any) => { if (!denseRows[r.node_id]) denseRows[r.node_id] = { text: r.text }; });
        }
        const t3 = nowMs();
        sse(controller, "step", { step: "lex_retrieval", lists: lexLists.length, ms: t3 - t2 });

        // Fusion
        const fused = rrfFuse([...denseLists, ...lexLists], 20);
        sse(controller, "step", { step: "fusion", candidates: fused.length });

        // Build candidate objects with text
        const cands = fused.map(f => ({ id: f.id, score: f.score, text: (denseRows[f.id]?.text || "") as string }))
          .sort((a, b) => {
            const da = a.id.startsWith("web://https://www.gasable.com") ? 1 : (a.id.startsWith("web://") ? 0.5 : 0);
            const db = b.id.startsWith("web://https://www.gasable.com") ? 1 : (b.id.startsWith("web://") ? 0.5 : 0);
            // Boost official domain, then other web, then file://
            if (da !== db) return db - da;
            return 0;
          });
        const selected = simpleMMR(cands, 8, 0.75);
        sse(controller, "step", { step: "selected_context", count: selected.length });

        const context = selected.map((s, i) => `[${i + 1}] ${s.text}`).join("\n\n");
        const sanitize = (text: string) => {
          if (!text) return "";
          let s = String(text);
          s = s.replace(/<[^>]+>/g, " ");
          s = s.replace(/https:\\s+/g, "https://").replace(/http:\\s+/g, "http://");
          s = s.replace(/\\s{2,}/g, " ");
          s = s.replace(/\\n{3,}/g, "\\n\\n");
          return s.trim();
        };
        let answer = "";
        const elapsed = nowMs() - tStart;
        if (elapsed > STREAM_BUDGET_MS) {
          answer = sanitize(selected.map(s => s.text).join("\n\n"));
          const resBody = {
            query: q,
            hits: selected.map(s => ({ id: s.id, score: s.score })),
            answer,
          };
          sse(controller, "final", resBody);
          controller.close();
          return;
        }
        try {
          const comp = await openai.chat.completions.create({
            model: ANSWER_MODEL,
            messages: [
              { role: "system", content: "Be informative but succinct. Use markdown. Begin with a short heading when appropriate (e.g., 'Gasable’s services'), then provide 5–10 clear bullet points with brief clarifications. Cite sources with [1], [2] based on the provided bracketed context indices. Use only the provided context. If context is missing or irrelevant, reply exactly: 'No context available.'" },
              { role: "user", content: `Question: ${q}\n\nContext:\n${context}` }
            ]
          });
          answer = sanitize(comp.choices[0].message.content || "");
        } catch {
          answer = sanitize(selected.map(s => s.text).join("\n\n"));
        }

        const resBody = {
          query: q,
          hits: selected.map(s => ({ id: s.id, score: s.score })),
          answer,
        };
        sse(controller, "final", resBody);
      } catch (err: any) {
        sse(controller, "final", { error: err?.message || String(err) });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "access-control-allow-origin": "*"
    }
  });
};


