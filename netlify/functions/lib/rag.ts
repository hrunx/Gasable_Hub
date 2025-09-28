import OpenAI from "openai";

export type PgClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
};

export interface DocHit {
  id: string;
  score: number;
  text: string;
  metadata?: any;
}

export type HybridStep =
  | "expansions"
  | "dense"
  | "lexical"
  | "keyword_prefilter"
  | "bm25"
  | "fusion"
  | "selection";

export type StepReporter = (step: HybridStep, payload: Record<string, any>) => void;

export interface HybridConfig {
  finalK: number;
  denseK: number;
  denseFuse: number;
  lexicalK: number;
  expansions: number;
  mmrLambda: number;
  useBm25: boolean;
  keywordPrefilter: boolean;
  preferDomainBoost: string | null;
  budgetMs: number;
}

export interface HybridRetrieveOptions {
  query: string;
  pg: PgClient;
  openai: OpenAI | null;
  reporter?: StepReporter;
  config?: Partial<HybridConfig>;
}

export interface HybridResult {
  query: string;
  language: "ar" | "en" | "mixed";
  expansions: string[];
  selected: DocHit[];
  fused: Array<{ id: string; score: number }>;
  budgetHit: boolean;
  elapsedMs: number;
}

const EMBED_MODEL = process.env.EMBED_MODEL || "text-embedding-3-large";
const EMBED_DIM = Number(process.env.EMBED_DIM || 3072);
const SCHEMA = process.env.PG_SCHEMA || "public";
const TABLE = process.env.PG_TABLE || "gasable_index";
const EMBED_COL_DEFAULT = (process.env.PG_EMBED_COL || "embedding").replace(/[^a-zA-Z0-9_]/g, "");
const ARABIC_RE = /[\u0600-\u06FF]/;
// Allow LLM to structure answers while still being instructed to use ONLY provided context.
// Default is false so the structured generator can "think" about the query.
const STRICT_CONTEXT_ONLY = String(process.env.STRICT_CONTEXT_ONLY || "false").toLowerCase() !== "false";
const RERANK_MODEL = process.env.RERANK_MODEL || process.env.OPENAI_MODEL || "gpt-5-mini";
const USE_HNSW = String(process.env.RAG_USE_HNSW || "false").toLowerCase() === "true";

const DEFAULTS: HybridConfig = {
  finalK: Number(process.env.RAG_TOP_K || 6),
  denseK: Number(process.env.RAG_K_DENSE_EACH || 8),
  denseFuse: Number(process.env.RAG_K_DENSE_FUSE || 16),
  lexicalK: Number(process.env.RAG_K_LEX || 12),
  expansions: Math.max(1, Number(process.env.RAG_EXPANSIONS || 3)),
  mmrLambda: Number(process.env.RAG_MMR_LAMBDA || 0.75),
  useBm25: String(process.env.RAG_USE_BM25 || process.env.USE_BM25 || "true").toLowerCase() !== "false",
  keywordPrefilter: String(process.env.RAG_KEYWORD_PREFILTER || "true").toLowerCase() !== "false",
  preferDomainBoost: process.env.RAG_BOOST_DOMAIN || "web://https://www.gasable.com",
  budgetMs: Number(process.env.SINGLESHOT_BUDGET_MS || process.env.RAG_BUDGET_MS || 8000),
};

export const DEFAULT_RAG_CONFIG = DEFAULTS;

function nowMs(): number {
  return Date.now();
}

// --- Runtime database feature detection (vector column, tsv availability) ---
let RESOLVED_EMBED_COL: string | null = null;
let HAS_TSV: boolean | null = null;

async function resolveDbFeatures(pg: PgClient): Promise<void> {
  if (RESOLVED_EMBED_COL !== null && HAS_TSV !== null) return;
  try {
    const colCheck = await pg.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name IN ('embedding_1536','embedding') ORDER BY CASE column_name WHEN 'embedding_1536' THEN 0 ELSE 1 END LIMIT 1`,
      [SCHEMA, TABLE]
    );
    RESOLVED_EMBED_COL = (colCheck.rows?.[0]?.column_name || EMBED_COL_DEFAULT).replace(/[^a-zA-Z0-9_]/g, "");
  } catch {
    RESOLVED_EMBED_COL = EMBED_COL_DEFAULT;
  }
  try {
    const tsvCheck = await pg.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name='tsv' LIMIT 1`,
      [SCHEMA, TABLE]
    );
    HAS_TSV = !!(tsvCheck.rows && tsvCheck.rows.length);
  } catch {
    HAS_TSV = false;
  }
}

// --- Local BM25 (parity with Python rank_bm25) ---
type Bm25State = {
  builtAt: number;
  docs: Array<{ id: string; text: string; tokens: string[] }>;
  df: Map<string, number>;
  avgdl: number;
};
let BM25_STATE_LOCAL: Bm25State | null = null;

function normalizeForBm25(text: string): string {
  const s = sanitizeText(text || "");
  return s.replace(/\s+/g, " ").trim();
}

function tokenizeForBm25(text: string): string[] {
  const t = normalizeForBm25(text).toLowerCase();
  return t.split(/[^a-z0-9\u0600-\u06FF]+/).filter(tok => tok.length > 1).slice(0, 4000);
}

async function loadCorpus(pg: PgClient, limitPerTable: number): Promise<Array<{ id: string; text: string }>> {
  const items: Array<{ id: string; text: string }> = [];
  try {
    const r1 = await pg.query(`SELECT node_id, COALESCE(text,'') AS t FROM ${SCHEMA}.${TABLE} LIMIT $1`, [limitPerTable]);
    r1.rows.forEach((r: any) => items.push({ id: `gasable_index:${r.node_id}`, text: normalizeForBm25(r.t || "") }));
  } catch {}
  try {
    const r2 = await pg.query(`SELECT id::text AS id, COALESCE(content,'') AS t FROM public.documents ORDER BY id DESC LIMIT $1`, [limitPerTable]);
    r2.rows.forEach((r: any) => items.push({ id: `documents:${r.id}`, text: normalizeForBm25(r.t || "") }));
  } catch {}
  try {
    const r3 = await pg.query(`SELECT id::text AS id, COALESCE(chunk_text,'') AS t FROM public.embeddings ORDER BY id DESC LIMIT $1`, [limitPerTable]);
    r3.rows.forEach((r: any) => items.push({ id: `embeddings:${r.id}`, text: normalizeForBm25(r.t || "") }));
  } catch {}
  return items;
}

async function buildBm25Local(pg: PgClient): Promise<Bm25State> {
  const limit = Math.max(50, Number(process.env.RAG_CORPUS_LIMIT || 600));
  const corpus = await loadCorpus(pg, limit);
  const docs = corpus
    .map(it => ({ id: it.id, text: it.text, tokens: tokenizeForBm25(it.text) }))
    .filter(d => d.tokens.length);
  const df = new Map<string, number>();
  docs.forEach(d => {
    const uniq = new Set(d.tokens);
    uniq.forEach(tok => df.set(tok, (df.get(tok) || 0) + 1));
  });
  const avgdl = docs.reduce((a, d) => a + d.tokens.length, 0) / Math.max(1, docs.length);
  BM25_STATE_LOCAL = { builtAt: nowMs(), docs, df, avgdl };
  return BM25_STATE_LOCAL;
}

async function getBm25Local(pg: PgClient): Promise<Bm25State> {
  const ttlSec = Math.max(60, Number(process.env.RAG_BM25_TTL_SEC || 300));
  if (!BM25_STATE_LOCAL || (nowMs() - BM25_STATE_LOCAL.builtAt) / 1000 > ttlSec) {
    return await buildBm25Local(pg);
  }
  return BM25_STATE_LOCAL;
}

function bm25Score(state: Bm25State, qTokens: string[], docTokens: string[]): number {
  const k1 = 1.5;
  const b = 0.75;
  const N = state.docs.length;
  const dl = docTokens.length;
  const avgdl = state.avgdl || 1;
  let score = 0;
  const tf = new Map<string, number>();
  docTokens.forEach(t => tf.set(t, (tf.get(t) || 0) + 1));
  const uniqQ = Array.from(new Set(qTokens));
  for (const term of uniqQ) {
    const df = state.df.get(term) || 0.5;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    const f = tf.get(term) || 0;
    score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (dl / avgdl))));
  }
  return score;
}

async function bm25SearchLocal(pg: PgClient, query: string, limit: number): Promise<DocHit[]> {
  const state = await getBm25Local(pg);
  const qTokens = tokenizeForBm25(query);
  if (!qTokens.length) return [];
  const scored = state.docs.map(d => ({ id: d.id, score: bm25Score(state, qTokens, d.tokens), text: d.text }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.max(1, limit));
  return top.map(h => ({ id: h.id, score: h.score, text: sanitizeText(h.text), metadata: undefined }));
}

function stripTatweel(text: string): string {
  return text.replace(/[\u0640]/g, "");
}

function preprocessText(text: string): string {
  if (!text) return "";
  let s = String(text);
  s = s.replace(/\u00ad/g, "");
  s = stripTatweel(s);
  s = s.replace(/(?<=[A-Za-z\u0600-\u06FF])\-\s+(?=[A-Za-z\u0600-\u06FF])/g, "");
  s = s.replace(/(?:\s*\/gid\d{5})+/gi, " ");
  s = s.replace(/([.!؟]){2,}/g, "$1");
  return s;
}

function hasArabic(text: string): boolean {
  return ARABIC_RE.test(text);
}

export function detectLanguage(text: string): "ar" | "en" | "mixed" {
  const raw = text || "";
  const arabic = hasArabic(raw);
  const latin = /[A-Za-z]/.test(raw);
  if (arabic && latin) return "mixed";
  if (arabic) return "ar";
  return "en";
}

function sanitizeText(text: string): string {
  if (!text) return "";
  let s = preprocessText(text);
  s = s.replace(/[\u2022\u25CF\u25A0\u25E6\u2219\u00B7]/g, " ");
  s = s.replace(/[\r\t]/g, " ");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/!\[[^\]]*\]\([^\)]*\)/g, " ");
  s = s.replace(/\[([^\]]*)\]\([^\)]*\)/g, (_m, p1) => p1 || "");
  s = s.replace(/https:\s+/g, "https://").replace(/http:\s+/g, "http://");
  s = s.replace(/\s{2,}/g, " ");
  s = s.replace(/\n{3,}/g, "\n\n");
  s = s.replace(/^\s*(Our\s+(Mission|Vision|Story)|Gasable\s+in\s+Figures).*$/gmi, "");
  s = s
    .split(/\n+/)
    .map(line => {
      const L = line.trim();
      if (!L) return "";
      const noPunct = /[\.!?]/.test(L) === false;
      const letters = L.replace(/[^A-Za-z]/g, "");
      const upperRatio = letters ? (letters.replace(/[^A-Z]/g, "").length / letters.length) : 0;
      if (noPunct && upperRatio > 0.6 && L.length > 14) return "";
      return L.replace(/^[-–•\u2022\s]+/, "");
    })
    .filter(Boolean)
    .join("\n");
  return s.trim();
}

// --- Intent helpers ---
function isBrandIntent(q: string): boolean {
  const t = String(q || "").toLowerCase();
  if (!t.includes("gasable")) return false;
  return /(what|who|about|profile|overview|services|company|mission|vision)\b/.test(t) || t.trim() === "gasable";
}

function isAboutIntent(q: string): boolean {
  const t = String(q || "").toLowerCase();
  return t.includes("gasable") && /(what\s+is|about|who\s+is|overview|profile)\b/.test(t);
}

function naiveExpansions(q: string): string[] {
  const base = String(q || "").trim();
  const parts = base.split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  if (base) out.add(base);
  if (parts.length > 1) {
    out.add(parts.slice().reverse().join(" "));
  }
  if (parts.length) {
    out.add(parts.map(p => p.replace(/ing\b/i, "")).join(" ").trim());
    out.add(parts.map(p => p.replace(/s\b/i, "")).join(" ").trim());
    out.add(parts.map(p => (p.length > 6 ? p.slice(0, 6) : p)).join(" ").trim());
  }
  // Domain synonyms to improve recall when OpenAI is unavailable
  const lower = base.toLowerCase();
  if (/\bev\b|electric\s*vehicle|charging|charger/i.test(lower)) {
    [
      "electric vehicle",
      "EV charging",
      "EV chargers",
      "charging station",
      "OCPP",
      "Type 2 charger",
    ].forEach(s => out.add(s));
  }
  if (/\bdelivery\b|doorstep|refuel|refueling|diesel\b/i.test(lower)) {
    [
      "on-demand delivery",
      "mobile refueling",
      "diesel delivery",
      "doorstep delivery",
      "fleet refueling",
    ].forEach(s => out.add(s));
  }
  if (/\biot\b|sensor|meter/i.test(lower)) {
    [
      "IoT sensors",
      "smart meters",
      "LPG sensor",
      "diesel sensor",
      "smart electric meter",
    ].forEach(s => out.add(s));
  }
  if (/gasable/i.test(lower)) {
    [
      "Gasable EV",
      "Gasable IoT",
      "Gasable delivery",
      "Gasable services",
    ].forEach(s => out.add(s));
  }
  return Array.from(out).filter(Boolean);
}

async function generateExpansions(
  openai: OpenAI | null,
  query: string,
  maxExpansions: number,
  budgetMs: number,
  langHint: "ar" | "en" | "mixed"
): Promise<string[]> {
  const base = sanitizeText(query);
  const fallback = [base, ...naiveExpansions(base)].filter(Boolean).slice(0, maxExpansions);
  // Curate expansions for brand/company intent to avoid dictionary-style expansions
  if (isBrandIntent(base)) {
    const set = new Set<string>();
    const push = (s: string) => { const t = sanitizeText(s); if (t) set.add(t); };
    [
      base,
      "Gasable",
      "About Gasable",
      "Gasable company profile",
      "Gasable services",
      "Gasable energy marketplace",
      "Gasable EV charging",
      "Gasable IoT",
      "Gasable delivery",
    ].forEach(push);
    return Array.from(set).slice(0, maxExpansions);
  }
  if (!openai) return fallback.length ? fallback : [query];

  const start = nowMs();
  try {
    const sys = "You produce only a JSON array of search queries. Ensure the array includes helpful English and Arabic variants whenever relevant. No text outside JSON.";
    const resp = await openai.chat.completions.create({
      model: process.env.RERANK_MODEL || process.env.OPENAI_MODEL || "gpt-5-mini",
      messages: [
        { role: "system", content: sys },
        {
          role: "user",
          content: `Original question (language: ${langHint}): ${query}\nReturn up to ${maxExpansions} concise search queries as a JSON array. Respect the original meaning, add synonyms, and include a translation to the other language if that improves recall.`,
        },
      ],
    });
    if (nowMs() - start > budgetMs) return fallback.length ? fallback : [query];
    const content = resp.choices?.[0]?.message?.content || "[]";
    const jsonText = (content.match(/\[.*\]/s) || [content])[0];
    const parsed = JSON.parse(jsonText);
    const uniq = new Set<string>();
    const out: string[] = [];
    const push = (text: string) => {
      const t = sanitizeText(text);
      if (!t) return;
      const key = t.toLowerCase();
      if (!uniq.has(key)) {
        uniq.add(key);
        out.push(t);
      }
    };
    push(base);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const val = String(item || "");
        // Drop dictionary/spelling expansions that derails brand questions
        if (/\b(meaning|definition|spelling|gaseable|gassable)\b/i.test(val)) continue;
        push(val);
        if (out.length >= maxExpansions) break;
      }
    }
    while (out.length < maxExpansions && fallback[out.length]) {
      push(fallback[out.length]);
    }
    return out.slice(0, maxExpansions);
  } catch (err) {
    console.warn('generateExpansions fallback', err);
    return fallback.length ? fallback : [query];
  }
}

async function embedOnce(openai: OpenAI, text: string): Promise<number[] | null> {
  try {
    const payload: any = { model: EMBED_MODEL, input: text };
    if (Number.isFinite(EMBED_DIM) && EMBED_DIM > 0) payload.dimensions = EMBED_DIM;
    const emb = await openai.embeddings.create(payload);
    const vec = emb?.data?.[0]?.embedding as number[] | undefined;
    return Array.isArray(vec) && vec.length ? vec : null;
  } catch (err) {
    console.warn('embedOnce failed', err);
    return null;
  }
}

function rrfFuse(lists: Array<Array<{ id: string; score: number }>>, limit: number): Array<{ id: string; score: number }> {
  const K = 60;
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((item, idx) => {
      const prev = scores.get(item.id) || 0;
      scores.set(item.id, prev + 1 / (K + idx + 1));
    });
  }
  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, score]) => ({ id, score }));
}

function simpleMMR(candidates: DocHit[], k: number, lambda: number): DocHit[] {
  const pool = candidates.slice();
  const selected: DocHit[] = [];
  const tokenize = (t: string) => new Set(String(t || "").split(/\W+/).filter(tok => tok.length > 2));
  const sim = (a: string, b: string) => {
    const A = tokenize(a);
    const B = tokenize(b);
    const inter = Array.from(A).filter(x => B.has(x)).length;
    const denom = Math.sqrt(A.size * B.size) || 1;
    return inter / denom;
  };
  while (selected.length < k && pool.length) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i += 1) {
      const rel = pool[i].score;
      let div = 0;
      for (const s of selected) div = Math.max(div, sim(pool[i].text, s.text));
      const val = lambda * rel - (1 - lambda) * div;
      if (val > bestScore) {
        bestScore = val;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    selected.push(pool.splice(bestIdx, 1)[0]);
  }
  return selected;
}

async function bm25Search(pg: PgClient, query: string, limit: number): Promise<DocHit[]> {
  try {
    // Prefer tsv if present
    if (HAS_TSV) {
      const sql = `
        SELECT node_id,
               left(COALESCE(text, li_metadata->>'chunk'), 2000) AS text,
               li_metadata,
               ts_rank_cd(tsv, plainto_tsquery('simple', $1)) AS score
        FROM ${SCHEMA}.${TABLE}
        WHERE tsv @@ plainto_tsquery('simple', $1)
        ORDER BY score DESC
        LIMIT $2`;
      const { rows } = await pg.query(sql, [query, limit]);
      return rows.map((r: any) => ({
        id: r.node_id,
        score: Number(r.score || 0),
        text: sanitizeText(r.text || ""),
        metadata: r.li_metadata,
      }));
    }
  } catch {}
  // Fallback naive lexical order by length
  try {
    const tokens = String(query || "")
      .split(/\s+/).map(t => t.trim()).filter(t => t.length > 2).slice(0, 6);
    if (!tokens.length) return [];
    const conds = tokens.map((_, i) => `COALESCE(text, li_metadata->>'chunk') ILIKE $${i + 1}`).join(' OR ');
    const pats = tokens.map(t => `%${t}%`);
    const sql = `
      SELECT node_id,
             left(COALESCE(text, li_metadata->>'chunk'), 2000) AS text,
             li_metadata,
             length(COALESCE(text, li_metadata->>'chunk')) AS score
      FROM ${SCHEMA}.${TABLE}
      WHERE ${conds}
      ORDER BY score DESC
      LIMIT $${pats.length + 1}`;
    const { rows } = await pg.query(sql, [...pats, limit]);
    return rows.map((r: any) => ({
      id: r.node_id,
      score: Number(r.score || 0),
      text: sanitizeText(r.text || ""),
      metadata: r.li_metadata,
    }));
  } catch {
    return [];
  }
}

async function keywordPrefilter(
  pg: PgClient,
  query: string,
  limitEach: number
): Promise<DocHit[][]> {
  const qnorm = String(query || "").toLowerCase();
  const en = [
    "contract","contracts","supplier","suppliers","diesel","fuel","agreement","terms","pricing",
    "scope","deliverables","penalties","liability","payment","rfq","tender","bid","procurement"
  ];
  const ar = [
    "عقد","عقود","مورد","المورد","موردين","ديزل","وقود","اتفاق","اتفاقية","شروط","تسعير","مناقصة","توريد"
  ];
  const kws = new Set<string>();
  for (const w of [...en, ...ar]) {
    if (qnorm.includes(w)) kws.add(w);
  }
  if (!kws.size) return [];
  const patterns = Array.from(kws).map(k => `%${k}%`);
  const conds = patterns.map((_, i) => `COALESCE(text, li_metadata->>'chunk') ILIKE $${i + 1}`).join(" OR ");
  const lists: DocHit[][] = [];
  try {
    const sql = `SELECT node_id, left(COALESCE(text, li_metadata->>'chunk'), 2000) AS text, li_metadata
                 FROM ${SCHEMA}.${TABLE}
                 WHERE ${conds}
                 LIMIT $${patterns.length + 1}`;
    const { rows } = await pg.query(sql, [...patterns, limitEach]);
    lists.push(rows.map((r: any) => ({
      id: r.node_id,
      score: 0.75,
      text: sanitizeText(r.text || ""),
      metadata: r.li_metadata,
    })));
  } catch {
    // ignore
  }
  try {
    const sql2 = `SELECT id::text AS node_id, left(COALESCE(content,''), 2000) AS text
                  FROM public.documents
                  WHERE ${patterns.map((_, i) => `content ILIKE $${i + 1}`).join(' OR ')}
                  ORDER BY id DESC LIMIT $${patterns.length + 1}`;
    const { rows } = await pg.query(sql2, [...patterns, limitEach]);
    if (rows.length) {
      lists.push(rows.map((r: any) => ({
        id: `documents:${r.node_id}`,
        score: 0.7,
        text: sanitizeText(r.text || ""),
      })));
    }
  } catch {
    // ignore
  }
  try {
    const sql3 = `SELECT id::text AS node_id, left(COALESCE(chunk_text,''), 2000) AS text
                  FROM public.embeddings
                  WHERE ${patterns.map((_, i) => `chunk_text ILIKE $${i + 1}`).join(' OR ')}
                  ORDER BY id DESC LIMIT $${patterns.length + 1}`;
    const { rows } = await pg.query(sql3, [...patterns, limitEach]);
    if (rows.length) {
      lists.push(rows.map((r: any) => ({
        id: `embeddings:${r.node_id}`,
        score: 0.65,
        text: sanitizeText(r.text || ""),
      })));
    }
  } catch {
    // ignore
  }
  return lists;
}

function applyDomainBoost(id: string, prefer: string | null): number {
  if (!prefer) return 0;
  if (id.startsWith(prefer)) return 0.5;
  if (prefer.startsWith("web://") && id.startsWith("web://")) return 0.25;
  return 0;
}

function noisePenaltyForId(id: string): number {
  const s = String(id || "").toLowerCase();
  let p = 0;
  // Penalize generic market or unrelated training slides and certificates
  if (s.includes("market_analysis") || s.includes("infrastructure market")) p += 0.35;
  if (s.includes("project risk") || s.includes("risk management")) p += 0.5;
  if (s.includes("certificate")) p += 0.4;
  if (s.includes("strategic supplier evaluation")) p += 0.35;
  if (s.includes("about us") || s.includes("our mission") || s.includes("our vision")) p += 0.3;
  if (s.includes("gmail") || s.includes("mail-") || s.includes("proposal")) p += 0.5;
  if (s.includes("ssms") || s.includes("incident") || s.includes("audit")) p += 0.4;
  // Prefer web sources when available over local file blobs
  if (s.startsWith("file://")) p += 0.05;
  return Math.min(0.9, p);
}

function noisePenaltyForText(text: string): number {
  const t = String(text || "").toLowerCase();
  let p = 0;
  if (/(join\s*now|request\s*a\s*quote|contribution\s*to\s*a\s*sustainable\s*environment)/i.test(t)) p += 0.5;
  if (/(dear|regards|gmail|quoted\s*text\s*hidden)/i.test(t)) p += 0.5;
  if (/(incident|audit|nonconformity|corrective\s*action|ssms)/i.test(t)) p += 0.4;
  return Math.min(0.9, p);
}

async function fetchMissing(pg: PgClient, ids: string[], cache: Map<string, DocHit>): Promise<void> {
  if (!ids.length) return;
  const unique = Array.from(new Set(ids.filter(id => id && !cache.has(id))));
  if (!unique.length) return;
  const sql = `SELECT node_id, left(COALESCE(text, li_metadata->>'chunk'), 2000) AS text, li_metadata
               FROM ${SCHEMA}.${TABLE}
               WHERE node_id = ANY($1::text[])`;
  try {
    const { rows } = await pg.query(sql, [unique]);
    rows.forEach((r: any) => {
      cache.set(r.node_id, {
        id: r.node_id,
        score: 0,
        text: sanitizeText(r.text || ""),
        metadata: r.li_metadata,
      });
    });
  } catch {
    // ignore
  }
}

export async function hybridRetrieve(options: HybridRetrieveOptions): Promise<HybridResult> {
  const { query, pg, openai, reporter } = options;
  const config = { ...DEFAULTS, ...(options.config || {}) };
  const start = nowMs();
  await resolveDbFeatures(pg);
  // Optional: create HNSW index to accelerate dense search (cosine)
  // Safe to call repeatedly; IF NOT EXISTS guards re-creation
  // This improves latency/scale but does not alter ranking logic
  if (USE_HNSW) {
    try {
      const vecCol = EMBED_DIM === 1536 ? (process.env.PG_EMBED_COL || "embedding_1536") : (process.env.PG_EMBED_COL || "embedding");
      await pg.query(
        `CREATE INDEX IF NOT EXISTS gasable_${vecCol}_hnsw ON ${SCHEMA}.${TABLE}
         USING hnsw (${vecCol} vector_cosine_ops) WITH (m=16, ef_construction=64)`
      );
    } catch {
      // ignore index creation errors
    }
  }
  const language = detectLanguage(query);
  const expansions = await generateExpansions(
    openai,
    query,
    Math.max(1, config.expansions),
    config.budgetMs,
    language
  );
  reporter?.("expansions", { count: expansions.length, expansions, language });

  const all = new Map<string, DocHit>();
  const denseLists: Array<Array<{ id: string; score: number }>> = [];
  const lexicalLists: Array<Array<{ id: string; score: number }>> = [];
  const keywordLists: Array<Array<{ id: string; score: number }>> = [];
  let bm25Hits: DocHit[] = [];
  let budgetHit = false;

  if (openai) {
    for (const exp of expansions) {
      if (nowMs() - start > config.budgetMs) { budgetHit = true; break; }
      const vec = await embedOnce(openai, exp);
      if (!vec?.length) continue;
      const vecText = `[${vec.map((x: number) => (Number.isFinite(x) ? x : 0)).join(",")}]`;
      try {
        const { rows } = await pg.query(
          `SELECT node_id,
                  left(COALESCE(text, li_metadata->>'chunk'), 2000) AS text,
                  li_metadata,
                  1 - (${RESOLVED_EMBED_COL} <=> $1::vector) AS score
           FROM ${SCHEMA}.${TABLE}
           ORDER BY ${RESOLVED_EMBED_COL} <=> $1::vector
           LIMIT $2`,
          [vecText, config.denseK]
        );
        const list: Array<{ id: string; score: number }> = [];
        rows.forEach((r: any) => {
          const hit: DocHit = {
            id: r.node_id,
            score: Number(r.score || 0),
            text: sanitizeText(r.text || ""),
            metadata: r.li_metadata,
          };
          if (!all.has(hit.id)) all.set(hit.id, hit);
          list.push({ id: hit.id, score: hit.score });
        });
        if (list.length) denseLists.push(list);
      } catch {
        // ignore individual failures
      }
      // Also query embeddings table if available, mirroring webapp.py behavior
      try {
        const { rows } = await pg.query(
          `SELECT ('embeddings:' || id::text) AS node_id,
                  left(COALESCE(chunk_text,''), 2000) AS text,
                  1.0 / (1.0 + (embedding <-> $1::vector)) AS score
           FROM public.embeddings
           ORDER BY (embedding <-> $1::vector) ASC
           LIMIT $2`,
          [vecText, config.denseK]
        );
        const list2: Array<{ id: string; score: number }> = [];
        rows.forEach((r: any) => {
          const hit: DocHit = {
            id: r.node_id,
            score: Number(r.score || 0),
            text: sanitizeText(r.text || ""),
            metadata: undefined,
          };
          if (!all.has(hit.id)) all.set(hit.id, hit);
          list2.push({ id: hit.id, score: hit.score });
        });
        if (list2.length) denseLists.push(list2);
      } catch {
        // embeddings table may not exist; ignore
      }
    }
  }
  reporter?.("dense", { lists: denseLists.length });

  for (const exp of expansions) {
    if (nowMs() - start > config.budgetMs) { budgetHit = true; break; }
    let tokens = String(exp || "")
      .split(/\s+/)
      .map(t => t.trim())
      .filter(t => t.length > 2)
      .slice(0, 6);
    if (isEVIntent(query)) {
      tokens = Array.from(new Set([...tokens, "ev", "electric", "vehicle", "charging", "charger", "ocpp", "station"]))
        .slice(0, 8);
    }
    if (!tokens.length) continue;
    const pats = tokens.map(t => `%${t}%`);
    const conds = tokens.map((_, i) => `COALESCE(text, li_metadata->>'chunk') ILIKE $${i + 1}`).join(" OR ");
    const sql = `SELECT node_id,
                        left(COALESCE(text, li_metadata->>'chunk'), 2000) AS text,
                        li_metadata
                 FROM ${SCHEMA}.${TABLE}
                 WHERE ${conds}
                 ORDER BY length(COALESCE(text, li_metadata->>'chunk')) DESC
                 LIMIT $${tokens.length + 1}`;
    try {
      const { rows } = await pg.query(sql, [...pats, config.lexicalK]);
      const list: Array<{ id: string; score: number }> = [];
      rows.forEach((r: any, idx: number) => {
        const hit: DocHit = {
          id: r.node_id,
          score: 1 / (idx + 1),
          text: sanitizeText(r.text || ""),
          metadata: r.li_metadata,
        };
        if (!all.has(hit.id)) all.set(hit.id, hit);
        list.push({ id: hit.id, score: hit.score });
      });
      if (list.length) lexicalLists.push(list);
    } catch {
      // ignore
    }
  }
  reporter?.("lexical", { lists: lexicalLists.length });

  if (config.keywordPrefilter && nowMs() - start <= config.budgetMs) {
    try {
      const lists = await keywordPrefilter(pg, query, config.lexicalK);
      lists.forEach(list => {
        if (!list.length) return;
        list.forEach(hit => {
          if (!all.has(hit.id)) all.set(hit.id, hit);
        });
        keywordLists.push(list.map(hit => ({ id: hit.id, score: hit.score })));
      });
      reporter?.("keyword_prefilter", { lists: keywordLists.length });
    } catch {
      reporter?.("keyword_prefilter", { lists: 0 });
    }
  } else {
    reporter?.("keyword_prefilter", { lists: 0 });
  }

  if (config.useBm25 && nowMs() - start <= config.budgetMs) {
    // Prefer DB tsv, then fallback to local BM25 parity
    const dbHits = await bm25Search(pg, query, config.denseFuse);
    bm25Hits = dbHits.length ? dbHits : await bm25SearchLocal(pg, query, config.denseFuse);
    bm25Hits.forEach(hit => {
      if (!all.has(hit.id)) all.set(hit.id, hit);
    });
    reporter?.("bm25", { hits: bm25Hits.length });
  } else {
    reporter?.("bm25", { hits: 0 });
  }

  const fusedLists = [...denseLists, ...lexicalLists, ...keywordLists];
  let fused = fusedLists.length ? rrfFuse(fusedLists, config.denseFuse) : [];
  if (!fused.length) {
    // fallback to bm25 hits when vector/lexical missing
    fused = bm25Hits.map((hit, idx) => ({ id: hit.id, score: 1 / (idx + 1) }));
  }
  reporter?.("fusion", { candidates: fused.length });

  const ensureIds = fused.map(f => f.id);
  if (bm25Hits.length) {
    bm25Hits.forEach(hit => ensureIds.push(hit.id));
  }
  await fetchMissing(pg, ensureIds, all);

  let candidates: DocHit[] = fused.map(f => {
    const base = all.get(f.id);
    if (base) {
      return { ...base, score: f.score };
    }
    return { id: f.id, score: f.score, text: "", metadata: undefined };
  });

  if (bm25Hits.length) {
    const merged = new Map<string, DocHit>();
    for (const hit of [...candidates, ...bm25Hits]) {
      const existing = merged.get(hit.id);
      if (!existing || hit.score > existing.score) {
        merged.set(hit.id, hit);
      }
    }
    candidates = Array.from(merged.values());
  }

  const deliveryTerms = ["deliver", "delivery", "doorstep", "order", "lpg", "cylinder", "diesel", "gasoline", "fuel"];
  const evTerms = ["ev", "charger", "charging", "ocpp", "type 2", "ac", "dc", "kW", "cpo", "wallbox", "powerly"];
  const brandTerms = ["gasable", "marketplace", "mission", "vision", "services", "about", "company", "platform", "sustainable", "un environment"];
  function isEVIntent(q: string): boolean {
    const t = String(q || "").toLowerCase();
    return evTerms.some(w => t.includes(w));
  }
  function idOverlapBoost(id: string, q: string): number {
    const t = String(id || "").toLowerCase().replace(/[^a-z0-9]+/g, " ");
    const qt = String(q || "").toLowerCase().replace(/[^a-z0-9]+/g, " ");
    let b = 0;
    for (const w of qt.split(/\s+/)) if (w && t.includes(w)) b += 0.03;
    for (const w of evTerms) if (t.includes(w)) b += 0.05;
    // Prefer obvious EV sources in filenames
    if (/sales\s*pitch|ev\s*infrastructure|evchargingsystems|evcs|charger|charging/.test(t)) b += 0.15;
    return Math.min(0.4, b);
  }
  function intentBoost(text: string): number {
    const t = String(text || "").toLowerCase();
    let b = 0;
    for (const w of deliveryTerms) if (t.includes(w)) b += 0.06;
    return Math.min(0.3, b);
  }
  function evBoost(text: string, id: string, active: boolean): number {
    if (!active) return 0;
    const t = String(text || "").toLowerCase() + " " + String(id || "").toLowerCase();
    let b = 0;
    for (const w of evTerms) if (t.includes(w)) b += 0.08;
    if (String(id||"").startsWith("web://https://www.gasable.com")) b += 0.2;
    return Math.min(0.6, b);
  }
  function overlapBoost(text: string, q: string): number {
    const toks = new Set(String(text || "").toLowerCase().split(/[^a-zA-Z0-9]+/).filter(t => t.length > 2));
    const qtok = new Set(String(q || "").toLowerCase().split(/[^a-zA-Z0-9]+/).filter(t => t.length > 2));
    if (!toks.size || !qtok.size) return 0;
    let inter = 0;
    for (const t of toks) if (qtok.has(t)) inter += 1;
    const ratio = inter / Math.max(1, qtok.size);
    return Math.min(0.5, ratio * 0.5);
  }

  function brandBoost(id: string, text: string, q: string): number {
    if (!isAboutIntent(q) && !isBrandIntent(q)) return 0;
    const s = (String(id || "") + " " + String(text || "")).toLowerCase();
    let b = 0;
    if (s.startsWith("web://https://www.gasable.com")) b += 0.35;
    if (/\bgasable\b/.test(s)) b += 0.1;
    for (const w of brandTerms) if (s.includes(w)) { b += 0.03; }
    if (/company\s*profile|corporate\s*portal|about\s*us|our\s*(mission|vision)/i.test(s)) b += 0.1;
    // Down-weight emails and proposals strongly for about intent
    if (/mail|gmail|proposal|re:|fw:/i.test(s)) b -= 0.25;
    return Math.max(-0.3, Math.min(0.6, b));
  }

  const evIntent = isEVIntent(query);
  const aboutIntent = isAboutIntent(query) || isBrandIntent(query);
  candidates.sort((a, b) => {
    const domainBoostA = evIntent ? 0 : applyDomainBoost(a.id, config.preferDomainBoost);
    const domainBoostB = evIntent ? 0 : applyDomainBoost(b.id, config.preferDomainBoost);
    const sa = a.score + domainBoostA + brandBoost(a.id, a.text, query) - noisePenaltyForId(a.id) - noisePenaltyForText(a.text) + intentBoost(a.text) + overlapBoost(a.text, query) + evBoost(a.text, a.id, evIntent) + idOverlapBoost(a.id, query);
    const sb = b.score + domainBoostB + brandBoost(b.id, b.text, query) - noisePenaltyForId(b.id) - noisePenaltyForText(b.text) + intentBoost(b.text) + overlapBoost(b.text, query) + evBoost(b.text, b.id, evIntent) + idOverlapBoost(b.id, query);
    return sb - sa;
  });

  // Filter out low-overlap/noisy candidates to reduce irrelevant emails/policies
  const qtok = new Set(String(query || "").toLowerCase().split(/[^a-zA-Z0-9]+/).filter(t => t.length > 2));
  function tokenOverlap(text: string): number {
    const toks = new Set(String(text || "").toLowerCase().split(/[^a-zA-Z0-9]+/).filter(t => t.length > 2));
    let inter = 0; for (const t of toks) if (qtok.has(t)) inter += 1; return inter;
  }
  const filtered = candidates.filter(c => {
    const inter = tokenOverlap(c.text);
    if (evIntent) return inter >= 2 || /\bev\b|charger|charging|ocpp|station|kW/i.test(c.text) || /ev|charger|charging|evcs|sales.*pitch/i.test(String(c.id||""));
    if (aboutIntent) return /gasable/i.test(c.text) || c.id.startsWith("web://https://www.gasable.com") || inter >= 1;
    return inter >= 1;
  });
  if (filtered.length >= Math.max(4, config.finalK)) candidates = filtered;

  // Optional LLM rerank before MMR selection
  let reranked = await rerankWithLLM(openai, query, candidates, config.budgetMs, start);
  let selected = simpleMMR(reranked, config.finalK, config.mmrLambda);
  if (!selected.length) {
    selected = candidates.slice(0, config.finalK);
  }

  reporter?.("selection", { selected: selected.length });

  // Final cleanup: ensure text present
  const missingText = selected.filter(hit => !hit.text).map(hit => hit.id);
  if (missingText.length) {
    await fetchMissing(pg, missingText, all);
    selected = selected.map(hit => {
      if (hit.text) return hit;
      const fromCache = all.get(hit.id);
      if (fromCache) {
        return { ...hit, text: fromCache.text, metadata: fromCache.metadata };
      }
      return hit;
    });
  }

  const elapsedMs = nowMs() - start;
  return {
    query,
    language,
    expansions,
    selected,
    fused,
    budgetHit,
    elapsedMs,
  };
}

export function formatAnswerFromHits(hits: DocHit[]): string {
  return sanitizeText(hits.map(h => h.text).join("\n\n"));
}

export function sanitizeAnswer(text: string): string {
  return sanitizeText(text);
}

// ---------------- Structured Answer Utilities ----------------
export interface StructuredSection {
  heading: string;
  bullets?: string[];
  paragraph?: string;
}

export interface StructuredAnswer {
  title: string;
  summary: string[]; // short bullets
  sections: StructuredSection[];
  sources: Array<{ id: string; label?: string }>;
}

function truncate(text: string, maxLen = 800): string {
  const s = sanitizeText(text);
  return s.length > maxLen ? s.slice(0, maxLen - 1) + "…" : s;
}

function normalizeForDedup(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeKeepTop(items: string[], maxItems: number, maxLen = 180): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const t = truncate(it, maxLen);
    const key = normalizeForDedup(t);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= maxItems) break;
  }
  return out;
}

function isNoisySentence(s: string): boolean {
  const t = String(s || "").toLowerCase();
  if (!t) return true;
  if (/(join\s*now|request\s*a\s*quote)/i.test(t)) return true;
  if (/(our\s+mission|our\s+vision|leading\s+platform|proudly\s+presents)/i.test(t)) return true;
  if (/all\s+rights\s+reserved/i.test(t)) return true;
  return false;
}

export function buildStructuredFromHits(query: string, hits: DocHit[], title?: string): StructuredAnswer {
  const top = hits.slice(0, 6);
  const summary: string[] = [];
  const sections: StructuredSection[] = [];
  const sources = top.map(h => ({ id: h.id }));
  const titleText = title || truncate(query, 140);

  // If it's an about/brand intent, prefer a consistent section layout
  if (isAboutIntent(query) || isBrandIntent(query)) {
    const text = formatAnswerFromHits(top).slice(0, 4000);
    const lines = text.split(/\n+/).map(s => sanitizeText(s)).filter(Boolean);
    const services: string[] = [];
    const mission: string[] = [];
    const scale: string[] = [];
    const products: string[] = [];
    const support: string[] = [];
    for (const s of lines) {
      const low = s.toLowerCase();
      if (/\b(ev|charger|charging|delivery|diesel|lpg|iot|sensor|meter|solar|battery)\b/.test(low)) services.push(s);
      else if (/\bmission|vision|sustainab|un environment|award|recognition\b/.test(low)) mission.push(s);
      else if (/\b1\.5\s*million|\b3000\b|network|stations|partners|cities\b/.test(low)) scale.push(s);
      else if (/\bapp|portal|platform|marketplace|powerly|dashboard|mobile\b/.test(low)) products.push(s);
      else if (/\b24\/7|support|customer care|service\s*level|sla\b/.test(low)) support.push(s);
    }
    const norm = (arr: string[], n: number) => dedupeKeepTop(arr, n, 160);
    if (services.length) sections.push({ heading: "Services", bullets: norm(services, 6) });
    if (products.length) sections.push({ heading: "Products & Platforms", bullets: norm(products, 4) });
    if (support.length) sections.push({ heading: "Support", bullets: norm(support, 4) });
    if (scale.length) sections.push({ heading: "Scale & Network", bullets: norm(scale, 4) });
    if (mission.length) sections.push({ heading: "Mission & Recognition", bullets: norm(mission, 4) });
    if (!sections.length) sections.push({ heading: "Overview", paragraph: truncate(text, 1200) });
    // Summary: 3-5 crisp bullets
    const sumSrc = [services[0], products[0], support[0], scale[0], mission[0]].filter(Boolean) as string[];
    const sum = dedupeKeepTop(sumSrc, 5, 150);
    if (sum.length) summary.push(...sum);
    if (!summary.length && top[0]?.text) summary.push(truncate(top[0].text, 150));
    return { title: titleText, summary, sections, sources };
  }

  const joinedText = formatAnswerFromHits(top);
  const sentences = joinedText
    .split(/(?<=[\.!؟])\s+|\n+/)
    .map(s => sanitizeText(s))
    .map(s => s.replace(/^[-–]/, "").trim())
    .filter(s => s.length >= 30 && s.length <= 260)
    .filter(s => !isNoisySentence(s));

  const qTokens = new Set(String(query).toLowerCase().split(/[^a-zA-Z0-9]+/).filter(t => t.length > 2));
  const scored = sentences
    .map(s => {
      const toks = new Set(s.toLowerCase().split(/[^a-zA-Z0-9]+/).filter(t => t.length > 2));
      let inter = 0;
      for (const t of toks) if (qTokens.has(t)) inter += 1;
      return { s, score: inter + Math.min(s.length, 220) / 220 * 0.1 };
    })
    .sort((a, b) => b.score - a.score)
    .map(x => x.s);

  const seen = new Set<string>();
  for (const s of scored) {
    const key = normalizeForDedup(s);
    if (seen.has(key)) continue;
    seen.add(key);
    summary.push(truncate(s, 160));
    if (summary.length >= 6) break;
  }

  if (!summary.length) summary.push(truncate(top[0]?.text || "No context available."));

  const services: string[] = [];
  const pricing: string[] = [];
  const deployment: string[] = [];
  const slas: string[] = [];
  const benefits: string[] = [];
  const svcRe = /(charge|charger|station|install|commission|ocpp|kW|DC|AC|EV|delivery|doorstep|order|lpg|diesel|gasoline|fuel)/i;
  const priceRe = /(price|pricing|tariff|cost|quote|vat|vat\s*invoice)/i;
  const depRe = /(site survey|load study|design|permitting|electrical|cabling|panel|civil|commission|handover)/i;
  const slasRe = /(sla|service level|uptime|response time|maintenance|support)/i;
  const benRe = /(efficien|cost|security|monitor|maintenance|reliab|scalab|insight|satisfaction)/i;
  for (const s of scored) {
    if (svcRe.test(s) && services.length < 8) services.push(truncate(s, 160));
    else if (priceRe.test(s) && pricing.length < 6) pricing.push(truncate(s, 160));
    else if (depRe.test(s) && deployment.length < 6) deployment.push(truncate(s, 160));
    else if (slasRe.test(s) && slas.length < 6) slas.push(truncate(s, 160));
    else if (benRe.test(s) && benefits.length < 8) benefits.push(truncate(s, 160));
  }
  const s1 = dedupeKeepTop(services, 6);
  const s2 = dedupeKeepTop(deployment, 4);
  const s3 = dedupeKeepTop(pricing, 4);
  const s4 = dedupeKeepTop(slas, 4);
  const s5 = dedupeKeepTop(benefits, 6);
  if (s1.length) sections.push({ heading: "Services", bullets: s1 });
  if (s2.length) sections.push({ heading: "Deployment", bullets: s2 });
  if (s3.length) sections.push({ heading: "Pricing & Commercials", bullets: s3 });
  if (s4.length) sections.push({ heading: "SLAs & Support", bullets: s4 });
  if (s5.length) sections.push({ heading: "Benefits", bullets: s5 });
  if (!sections.length) sections.push({ heading: "Details", paragraph: truncate(joinedText, 1200) });

  return { title: titleText, summary, sections, sources };
}

export function structuredToHtml(ans: StructuredAnswer): string {
  const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const parts: string[] = [];
  if (ans.title) parts.push(`<h3>${esc(ans.title)}</h3>`);
  if (ans.summary?.length) {
    parts.push("<ul>" + ans.summary.map(b => `<li>${esc(b)}</li>`).join("") + "</ul>");
  }
  for (const sec of ans.sections || []) {
    if (sec.heading) parts.push(`<h4>${esc(sec.heading)}</h4>`);
    if (sec.paragraph) parts.push(`<p>${esc(sec.paragraph)}</p>`);
    if (sec.bullets?.length) parts.push("<ul>" + sec.bullets.map(b => `<li>${esc(b)}</li>`).join("") + "</ul>");
  }
  if (ans.sources?.length) {
    parts.push('<div class="sources"><b>Sources:</b> ' + ans.sources.map(s => esc(s.label || s.id)).join("; ") + "</div>");
  }
  return parts.join("\n");
}

const ANSWER_MODEL = process.env.ANSWER_MODEL || process.env.RERANK_MODEL || process.env.OPENAI_MODEL || "gpt-5-mini";

export async function generateStructuredAnswer(
  openai: OpenAI | null,
  query: string,
  hits: DocHit[],
  budgetMs: number
): Promise<StructuredAnswer> {
  // Fallback immediately if LLM is unavailable or no hits
  const llm = STRICT_CONTEXT_ONLY ? null : openai;
  if (!llm || !hits?.length) return buildStructuredFromHits(query, hits || []);

  const t0 = nowMs();
  // Provide concise, budget-friendly context to the LLM
  const context = hits.slice(0, 8).map((h, i) => `[${i + 1}] ${truncate(h.text, 550)}`).join("\n\n");
  const schema = {
    title: "string",
    summary: ["string"],
    sections: [{ heading: "string", bullets: ["string"], paragraph: "string" }],
    sources: [{ id: "string", label: "string" }],
  };
  const sys = "You return ONLY strict JSON for a structured answer. No prose, no markdown, no code fences. Keep it concise, to-the-point, and well-organized. Use bullets only for lists and keep each bullet under 180 characters. Answer using ONLY the provided context.";
  const usr = `Question: ${query}\n\nContext:\n${context}\n\nReturn JSON with this schema (omit empty fields): ${JSON.stringify(schema)}\nRules:\n- title: short phrase.\n- summary: 4–8 crisp bullets.\n- sections: 1–3 with helpful headings, use bullets only when natural.\n- sources: map to [index] if possible using labels like "+ [1] excerpt".`;

  try {
    const comp = await llm.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: usr },
      ],
      temperature: 0.15,
    });
    if (nowMs() - t0 > budgetMs) return buildStructuredFromHits(query, hits);
    const raw = comp.choices?.[0]?.message?.content || "{}";
    const jsonText = (raw.match(/\{[\s\S]*\}/) || [raw])[0];
    const parsed = JSON.parse(jsonText);
    // Minimal validation
    const title = truncate(parsed.title || query, 140);
    const summary = Array.isArray(parsed.summary) ? parsed.summary.map((s: any) => truncate(String(s || ""), 260)).filter(Boolean) : [];
    const sections: StructuredSection[] = Array.isArray(parsed.sections)
      ? parsed.sections.map((sec: any) => ({
          heading: truncate(String(sec?.heading || ""), 120),
          bullets: Array.isArray(sec?.bullets) ? sec.bullets.map((b: any) => truncate(String(b || ""), 260)).filter(Boolean) : undefined,
          paragraph: sec?.paragraph ? truncate(String(sec.paragraph || ""), 1200) : undefined,
        })).filter((s: any) => s.heading || (s.bullets && s.bullets.length) || s.paragraph)
      : [];
    const sources = Array.isArray(parsed.sources)
      ? parsed.sources.map((s: any) => ({ id: String(s?.id || ""), label: s?.label ? truncate(String(s.label), 260) : undefined })).filter((s: any) => s.id)
      : hits.slice(0, 6).map(h => ({ id: h.id }));

    return { title, summary: summary.slice(0, 8), sections: sections.slice(0, 4), sources };
  } catch (err) {
    console.warn("generateStructuredAnswer fallback", err);
    return buildStructuredFromHits(query, hits);
  }
}

async function rerankWithLLM(openai: OpenAI | null, query: string, candidates: DocHit[], budgetMs: number, tStart: number): Promise<DocHit[]> {
  if (STRICT_CONTEXT_ONLY || !openai || !candidates?.length) return candidates;
  try {
    const snip = (s: string) => String(s || "").replace(/\s+/g, ' ').slice(0, 900);
    const passages = candidates.map((h, i) => `[${i}] ${snip(h.text)}`).join("\n\n");
    const resp = await openai.chat.completions.create({
      model: RERANK_MODEL,
      messages: [
        { role: "system", content: "You are a precise reranker. Return a JSON array [{index:int, score:float}] only." },
        { role: "user", content: `Query: ${query}\n\nPassages:\n${passages}` },
      ],
      temperature: 0,
    });
    if (nowMs() - tStart > budgetMs) return candidates;
    const raw = resp.choices?.[0]?.message?.content || "[]";
    const jsonText = (raw.match(/\[.*\]/s) || [raw])[0];
    const arr = JSON.parse(jsonText);
    const mapped = Array.isArray(arr)
      ? arr
          .filter((x: any) => Number.isFinite(x.index) && x.index >= 0 && x.index < candidates.length)
          .map((x: any) => ({ ...candidates[x.index], score: Number(x.score || 0) }))
      : candidates;
    mapped.sort((a, b) => b.score - a.score);
    return mapped;
  } catch {
    return candidates;
  }
}

export async function lexicalFallback(
  pg: PgClient,
  query: string,
  limit: number,
  preferDomain: string | null
): Promise<DocHit[]> {
  const tokens = String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2)
    .slice(0, 8);
  const cap = Math.max(1, Math.min(limit || DEFAULTS.finalK, 24));
  const params = tokens.map(t => `%${t}%`);
  const scoreExpr = tokens.length
    ? tokens.map((_, idx) => `CASE WHEN COALESCE(text, li_metadata->>'chunk') ILIKE $${idx + 1} THEN 1 ELSE 0 END`).join(' + ')
    : '0';

  const results: DocHit[] = [];
  const pushRows = (rows: any[], scoreField: string = 'score_calc') => {
    for (const r of rows) {
      results.push({
        id: r.node_id,
        score: Number(r[scoreField] || 0),
        text: sanitizeText(r.text || ""),
        metadata: r.li_metadata,
      });
    }
  };

  // gasable_index
  try {
    const sql = `SELECT node_id,
                        left(COALESCE(text, li_metadata->>'chunk'), 2000) AS text,
                        li_metadata,
                        (${scoreExpr}) AS score_calc
                 FROM ${SCHEMA}.${TABLE}
                 ORDER BY score_calc DESC, length(COALESCE(text, li_metadata->>'chunk')) DESC
                 LIMIT $${params.length + 1}`;
    const { rows } = await pg.query(sql, [...params, cap]);
    pushRows(rows);
  } catch (err) {
    console.warn('lexicalFallback gasable_index failed', err);
  }

  // documents
  try {
    const cond = tokens.length ? tokens.map((_, i) => `content ILIKE $${i + 1}`).join(' OR ') : 'true';
    const sql = `SELECT ('documents:' || id::text) AS node_id,
                        left(COALESCE(content,''), 2000) AS text,
                        '{}'::jsonb AS li_metadata,
                        (${tokens.length ? tokens.map((_, i) => `CASE WHEN content ILIKE $${i + 1} THEN 1 ELSE 0 END`).join(' + ') : '0'}) AS score_calc
                 FROM public.documents
                 WHERE ${cond}
                 ORDER BY score_calc DESC, id DESC
                 LIMIT $${params.length + 1}`;
    const { rows } = await pg.query(sql, [...params, cap]);
    pushRows(rows);
  } catch (err) {
    // ignore if table missing
  }

  // embeddings
  try {
    const cond = tokens.length ? tokens.map((_, i) => `chunk_text ILIKE $${i + 1}`).join(' OR ') : 'true';
    const sql = `SELECT ('embeddings:' || id::text) AS node_id,
                        left(COALESCE(chunk_text,''), 2000) AS text,
                        '{}'::jsonb AS li_metadata,
                        (${tokens.length ? tokens.map((_, i) => `CASE WHEN chunk_text ILIKE $${i + 1} THEN 1 ELSE 0 END`).join(' + ') : '0'}) AS score_calc
                 FROM public.embeddings
                 WHERE ${cond}
                 ORDER BY score_calc DESC, id DESC
                 LIMIT $${params.length + 1}`;
    const { rows } = await pg.query(sql, [...params, cap]);
    pushRows(rows);
  } catch (err) {
    // ignore if table missing
  }

  if (!results.length) return [];

  // Rerank using same heuristics as hybrid: domain boost, noise penalties, overlap, EV
  const prefer = preferDomain || null;
  const evIntent = /\bev\b|charger|charging|ocpp|station|kW/i.test(query);
  const scored = results.map(h => {
    const domainBoost = evIntent ? 0 : applyDomainBoost(h.id, prefer);
    const final = h.score + domainBoost - noisePenaltyForId(h.id) - noisePenaltyForText(h.text);
    return { ...h, score: final };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, cap);
}
