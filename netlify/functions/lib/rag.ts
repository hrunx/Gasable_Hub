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
  llmRerank?: boolean;
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
  language: "ar" | "en";
  expansions: string[];
  selected: DocHit[];
  fused: Array<{ id: string; score: number }>;
  budgetHit: boolean;
  elapsedMs: number;
}

const EMBED_MODEL = process.env.EMBED_MODEL || "text-embedding-3-small";
const EMBED_DIM = Number(process.env.EMBED_DIM || 1536);
const SCHEMA = process.env.PG_SCHEMA || "public";
const TABLE = process.env.PG_TABLE || "gasable_index";
const EMBED_COL_DEFAULT = (process.env.PG_EMBED_COL || "embedding_1536").replace(/[^a-zA-Z0-9_]/g, "");
const ARABIC_RE = /[\u0600-\u06FF]/;
const STRICT_CONTEXT_ONLY = String(process.env.STRICT_CONTEXT_ONLY || "false").toLowerCase() !== "false";

const DEFAULTS: HybridConfig = {
  finalK: Number(process.env.RAG_TOP_K || 6),
  denseK: Number(process.env.RAG_K_DENSE_EACH || 8),
  denseFuse: Number(process.env.RAG_K_DENSE_FUSE || 16),
  lexicalK: Number(process.env.RAG_K_LEX || 12),
  expansions: Math.max(1, Number(process.env.RAG_EXPANSIONS || 2)),
  mmrLambda: Number(process.env.RAG_MMR_LAMBDA || 0.7),
  useBm25: String(process.env.RAG_USE_BM25 || process.env.USE_BM25 || "true").toLowerCase() !== "false",
  keywordPrefilter: String(process.env.RAG_KEYWORD_PREFILTER || "true").toLowerCase() !== "false",
  preferDomainBoost: process.env.RAG_BOOST_DOMAIN || null,
  budgetMs: Number(process.env.SINGLESHOT_BUDGET_MS || process.env.RAG_BUDGET_MS || 8000),
  llmRerank: false,
};

export const DEFAULT_RAG_CONFIG = DEFAULTS;

function nowMs(): number {
  return Date.now();
}

let RESOLVED_EMBED_COL: string | null = null;

async function resolveDbFeatures(pg: PgClient): Promise<void> {
  if (RESOLVED_EMBED_COL !== null) return;
  try {
    const colCheck = await pg.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name IN ('embedding_1536','embedding') ORDER BY CASE column_name WHEN 'embedding_1536' THEN 0 ELSE 1 END LIMIT 1`,
      [SCHEMA, TABLE]
    );
    RESOLVED_EMBED_COL = (colCheck.rows?.[0]?.column_name || EMBED_COL_DEFAULT).replace(/[^a-zA-Z0-9_]/g, "");
  } catch {
    RESOLVED_EMBED_COL = EMBED_COL_DEFAULT;
  }
}

function stripTatweel(text: string): string {
  return text.replace(/\u0640/g, "");
}

function cleanText(raw: string): string {
  if (!raw) return "";
  let text = String(raw);
  text = text.replace(/\u00ad/g, "");
  text = text.replace(/(?<=[A-Za-z\u0600-\u06FF])-\s+(?=[A-Za-z\u0600-\u06FF])/g, "");
  text = text.replace(/(?:\s*\/gid\d{5})+/gi, " ");
  text = text.replace(/gid\d{5}/gi, " ");
  text = text.replace(/\s*\/\s*/g, " / ");
  text = text.replace(/[^\w\u0600-\u06FF\.,;:!?\-()\[\]{}\s]+/g, " ");
  text = text.replace(/[–—]/g, "-");
  text = text.replace(/…/g, "...");
  text = text.replace(/([\.!?،])\1{2,}/g, "$1$1");
  text = text.replace(/\s+/g, " ");
  return text.trim();
}

function normalizeText(raw: string): string {
  if (!raw) return "";
  let text = stripTatweel(String(raw));
  text = text.replace(/\s+/g, " ");
  return text.trim();
}

function sanitizeText(text: string): string {
  return normalizeText(cleanText(text));
}

export function detectLanguage(text: string): "ar" | "en" {
  return ARABIC_RE.test(text || "") ? "ar" : "en";
}

type Bm25Doc = { id: string; text: string; tokens: string[] };

type Bm25State = {
  builtAt: number;
  docs: Bm25Doc[];
  df: Map<string, number>;
  avgdl: number;
};

let BM25_STATE: Bm25State | null = null;

async function loadCorpus(pg: PgClient, limitPerTable: number): Promise<Bm25Doc[]> {
  const rows: Bm25Doc[] = [];
  try {
    const res = await pg.query(`SELECT node_id, COALESCE(text,'') AS t FROM ${SCHEMA}.${TABLE} LIMIT $1`, [limitPerTable]);
    res.rows.forEach((r: any) => {
      const text = sanitizeText(r.t || "");
      const tokens = text.split(" ").filter(Boolean);
      if (tokens.length) rows.push({ id: `gasable_index:${r.node_id}`, text, tokens });
    });
  } catch {}
  try {
    const res = await pg.query(`SELECT id::text AS id, COALESCE(content,'') AS t FROM public.documents ORDER BY id DESC LIMIT $1`, [limitPerTable]);
    res.rows.forEach((r: any) => {
      const text = sanitizeText(r.t || "");
      const tokens = text.split(" ").filter(Boolean);
      if (tokens.length) rows.push({ id: `documents:${r.id}`, text, tokens });
    });
  } catch {}
  try {
    const res = await pg.query(`SELECT id::text AS id, COALESCE(chunk_text,'') AS t FROM public.embeddings ORDER BY id DESC LIMIT $1`, [limitPerTable]);
    res.rows.forEach((r: any) => {
      const text = sanitizeText(r.t || "");
      const tokens = text.split(" ").filter(Boolean);
      if (tokens.length) rows.push({ id: `embeddings:${r.id}`, text, tokens });
    });
  } catch {}
  return rows;
}

async function buildBm25State(pg: PgClient): Promise<Bm25State> {
  const limit = Math.max(50, Number(process.env.RAG_CORPUS_LIMIT || 1200));
  const docs = await loadCorpus(pg, limit);
  const df = new Map<string, number>();
  docs.forEach(doc => {
    const uniq = new Set(doc.tokens);
    uniq.forEach(tok => df.set(tok, (df.get(tok) || 0) + 1));
  });
  const avgdl = docs.reduce((sum, doc) => sum + doc.tokens.length, 0) / Math.max(1, docs.length);
  BM25_STATE = { builtAt: nowMs(), docs, df, avgdl };
  return BM25_STATE;
}

async function getBm25State(pg: PgClient): Promise<Bm25State> {
  const ttlSec = Math.max(60, Number(process.env.RAG_BM25_TTL_SEC || 300));
  if (!BM25_STATE || (nowMs() - BM25_STATE.builtAt) / 1000 > ttlSec) {
    return await buildBm25State(pg);
  }
  return BM25_STATE;
}

function bm25Score(state: Bm25State, qTokens: string[], docTokens: string[]): number {
  const k1 = 1.5;
  const b = 0.75;
  const N = state.docs.length || 1;
  const dl = docTokens.length || 1;
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

type RetrievalItem = {
  source: string;
  id: string;
  text: string;
  score: number;
};

async function bm25Search(pg: PgClient, query: string, limit: number): Promise<RetrievalItem[]> {
  const state = await getBm25State(pg);
  const qTokens = sanitizeText(query).split(" ").filter(Boolean);
  if (!qTokens.length) return [];
  const scored = state.docs.map(doc => ({
    doc,
    score: bm25Score(state, qTokens, doc.tokens),
  }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.max(1, limit));
  return top.map(({ doc, score }) => {
    const [source, id] = doc.id.split(":", 2);
    return {
      source: source || "gasable_index",
      id: id || doc.id,
      text: doc.text,
      score,
    };
  });
}

async function embedQueries(openai: OpenAI, queries: string[]): Promise<number[][]> {
  if (!queries.length) return [];
  const payload: any = { model: EMBED_MODEL, input: queries };
  if (Number.isFinite(EMBED_DIM) && EMBED_DIM > 0) payload.dimensions = EMBED_DIM;
  const resp = await openai.embeddings.create(payload);
  return resp.data.map((item: any) => item.embedding as number[]);
}

function vectorToPg(vec: number[]): string {
  return `[${vec.map(v => (Number.isFinite(v) ? v.toFixed(8) : "0.00000000")).join(",")}]`;
}

async function vectorSearchCombined(
  pg: PgClient,
  vec: number[],
  kEach: number
): Promise<RetrievalItem[]> {
  if (!vec?.length) return [];
  const pgVec = vectorToPg(vec);
  const results: RetrievalItem[] = [];
  try {
    const { rows } = await pg.query(
      `SELECT node_id, COALESCE(text,'') AS text, 1 - (${RESOLVED_EMBED_COL} <=> $1::vector) AS score
       FROM ${SCHEMA}.${TABLE}
       ORDER BY ${RESOLVED_EMBED_COL} <=> $1::vector
       LIMIT $2`,
      [pgVec, kEach]
    );
    rows.forEach((r: any) => {
      results.push({
        source: "gasable_index",
        id: r.node_id,
        text: sanitizeText(r.text || ""),
        score: Number(r.score || 0),
      });
    });
  } catch {}
  try {
    const { rows } = await pg.query(
      `SELECT id::text AS id, COALESCE(chunk_text,'') AS text, 1.0 / (1.0 + (embedding <-> $1::vector)) AS score
       FROM public.embeddings
       ORDER BY (embedding <-> $1::vector) ASC
       LIMIT $2`,
      [pgVec, kEach]
    );
    rows.forEach((r: any) => {
      results.push({
        source: "embeddings",
        id: r.id,
        text: sanitizeText(r.text || ""),
        score: Number(r.score || 0),
      });
    });
  } catch {}
  return results;
}

async function keywordPrefilter(
  pg: PgClient,
  query: string,
  limitEach: number
): Promise<RetrievalItem[][]> {
  const norm = sanitizeText(query).toLowerCase();
  const keywords: string[] = [];
  const en = [
    "contract","contracts","supplier","suppliers","diesel","fuel","agreement","terms","pricing",
    "sow","sla","rfq","tender","bid","procurement","scope","deliverables","penalties","liability",
    "payment","incoterms","delivery","quantity","quality","specification"
  ];
  const ar = [
    "عقد","عقود","مورد","المورد","موردين","تزويد","توريد","ديزل","وقود","اتفاق","اتفاقية",
    "شروط","تسعير","مناقصة","عطاء","توريدات","دفعات","دفع","ترسية","التزامات","جزاءات",
    "حدود المسؤولية","جودة","كمية","مواصفات","تسليم","جدول زمني"
  ];
  [...en, ...ar].forEach(word => {
    if (norm.includes(word)) keywords.push(word);
  });
  if (!keywords.length) return [];
  const patterns = Array.from(new Set(keywords)).map(k => `%${k}%`);
  const lists: RetrievalItem[][] = [];
  try {
    const sql = `SELECT node_id, left(COALESCE(text,''), 2000) AS text
                 FROM ${SCHEMA}.${TABLE}
                 WHERE ` + patterns.map((_, i) => `text ILIKE $${i + 1}`).join(" OR ") + `
                 LIMIT $${patterns.length + 1}`;
    const { rows } = await pg.query(sql, [...patterns, limitEach]);
    if (rows.length) {
      lists.push(rows.map((r: any) => ({
        source: "gasable_index",
        id: r.node_id,
        text: sanitizeText(r.text || ""),
        score: 0.75,
      })));
    }
  } catch {}
  try {
    const sql = `SELECT id::text AS id, left(COALESCE(content,''), 2000) AS text
                 FROM public.documents
                 WHERE ` + patterns.map((_, i) => `content ILIKE $${i + 1}`).join(" OR ") + `
                 ORDER BY id DESC LIMIT $${patterns.length + 1}`;
    const { rows } = await pg.query(sql, [...patterns, limitEach]);
    if (rows.length) {
      lists.push(rows.map((r: any) => ({
        source: "documents",
        id: r.id,
        text: sanitizeText(r.text || ""),
        score: 0.7,
      })));
    }
  } catch {}
  try {
    const sql = `SELECT id::text AS id, left(COALESCE(chunk_text,''), 2000) AS text
                 FROM public.embeddings
                 WHERE ` + patterns.map((_, i) => `chunk_text ILIKE $${i + 1}`).join(" OR ") + `
                 ORDER BY id DESC LIMIT $${patterns.length + 1}`;
    const { rows } = await pg.query(sql, [...patterns, limitEach]);
    if (rows.length) {
      lists.push(rows.map((r: any) => ({
        source: "embeddings",
        id: r.id,
        text: sanitizeText(r.text || ""),
        score: 0.65,
      })));
    }
  } catch {}
  return lists;
}

function rrfFuse(resultLists: RetrievalItem[][], k: number): Array<RetrievalItem & { rrf: number }> {
  const K = 60;
  const scores = new Map<string, number>();
  const meta = new Map<string, RetrievalItem>();
  for (const list of resultLists) {
    list.forEach((item, idx) => {
      const key = `${item.source}:${item.id}`;
      const addition = 1 / (K + idx + 1);
      scores.set(key, (scores.get(key) || 0) + addition);
      if (!meta.has(key)) meta.set(key, item);
    });
  }
  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([key, rrf]) => {
      const base = meta.get(key)!;
      return { ...base, rrf };
    });
}

function tokenizeForSimilarity(text: string): Set<string> {
  if (!text) return new Set();
  const matches = text.toLowerCase().match(/[A-Za-z\u0600-\u06FF][A-Za-z0-9_\u0600-\u06FF]{2,}/g);
  return new Set(matches || []);
}

function jaccardSim(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  a.forEach(tok => {
    if (b.has(tok)) inter += 1;
  });
  return inter / (a.size + b.size - inter || 1);
}

function mmrSelect(candidates: Array<RetrievalItem & { rrf: number }>, k: number, lambdaWeight: number): RetrievalItem[] {
  const pool = candidates.map(item => ({ ...item, _tokens: tokenizeForSimilarity(item.text) }));
  const selected: Array<typeof pool[number]> = [];
  while (pool.length && selected.length < k) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    pool.forEach((cand, idx) => {
      let maxSim = 0;
      for (const picked of selected) {
        const sim = jaccardSim(cand._tokens, picked._tokens);
        if (sim > maxSim) maxSim = sim;
      }
      const score = lambdaWeight * cand.rrf - (1 - lambdaWeight) * maxSim;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    });
    if (bestIdx === -1) break;
    const [chosen] = pool.splice(bestIdx, 1);
    selected.push(chosen);
  }
  return selected.map(({ _tokens, ...rest }) => rest);
}

async function generateQueryExpansions(
  openai: OpenAI | null,
  query: string,
  lang: "ar" | "en",
  maxExpansions: number
): Promise<string[]> {
  const base = sanitizeText(query);
  if (!base) return [];
  const seen = new Set<string>();
  const push = (text: string) => {
    const val = sanitizeText(text);
    if (val) seen.add(val);
  };
  push(base);
  if (!openai) return Array.from(seen);
  try {
    const prompt =
      "You rewrite the user's question into up to 4 concise search queries. Provide: synonyms, rephrasings, and a translation to the other language (English/Arabic) if helpful. Return a JSON array of strings only.";
    const resp = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      messages: [
        { role: "system", content: "You produce only JSON arrays of search queries. Always include at least one Arabic and one English variant if the question is not already bilingual." },
        { role: "user", content: `Question language: ${lang}. Original: ${query}\n${prompt}` },
      ],
    });
    const content = resp.choices?.[0]?.message?.content || "[]";
    const jsonText = (content.match(/\[.*\]/s) || [content])[0];
    const parsed = JSON.parse(jsonText);
    if (Array.isArray(parsed)) {
      parsed.forEach(item => {
        if (typeof item === "string") push(item);
        if (typeof item === "number" || typeof item === "boolean") push(String(item));
      });
    }
  } catch {
    // ignore and fall back to base only
  }
  return Array.from(seen).slice(0, Math.max(1, Math.min(1 + maxExpansions, 5)));
}

function keyFromItem(item: RetrievalItem): string {
  return `${item.source}:${item.id}`;
}

export async function hybridRetrieve(options: HybridRetrieveOptions): Promise<HybridResult> {
  const { query, pg, openai, reporter } = options;
  const config = { ...DEFAULTS, ...(options.config || {}) };
  const start = nowMs();
  await resolveDbFeatures(pg);
  const language = detectLanguage(query);
  const expansions = await generateQueryExpansions(openai, query, language, config.expansions);
  reporter?.("expansions", { count: expansions.length, expansions, language });

  const denseLists: RetrievalItem[][] = [];
  const lexicalLists: RetrievalItem[][] = [];
  const keywordLists: RetrievalItem[][] = [];
  let bm25Primary: RetrievalItem[] = [];
  let budgetHit = false;

  if (openai && expansions.length) {
    try {
      const vecs = await embedQueries(openai, expansions);
      for (let i = 0; i < vecs.length; i += 1) {
        if (nowMs() - start > config.budgetMs) {
          budgetHit = true;
          break;
        }
        const vec = vecs[i];
        const list = await vectorSearchCombined(pg, vec, config.denseK);
        if (list.length) denseLists.push(list);
      }
    } catch {
      // ignore embedding failures
    }
  }
  reporter?.("dense", { lists: denseLists.length });

  for (let i = 0; i < expansions.length; i += 1) {
    if (nowMs() - start > config.budgetMs) {
      budgetHit = true;
      break;
    }
    const exp = expansions[i];
    const hits = config.useBm25 ? await bm25Search(pg, exp, config.lexicalK) : [];
    if (hits.length) lexicalLists.push(hits);
    if (i === 0) bm25Primary = hits;
  }
  reporter?.("lexical", { lists: lexicalLists.length });
  reporter?.("bm25", { hits: bm25Primary.length });

  if (config.keywordPrefilter && nowMs() - start <= config.budgetMs) {
    const lists = await keywordPrefilter(pg, query, config.lexicalK);
    lists.forEach(list => {
      if (list.length) keywordLists.push(list);
    });
  }
  reporter?.("keyword_prefilter", { lists: keywordLists.length });

  const fused = rrfFuse([...denseLists, ...lexicalLists, ...keywordLists], config.denseFuse);
  reporter?.("fusion", { candidates: fused.length });

  const selectedItems = mmrSelect(fused, config.finalK, config.mmrLambda);
  reporter?.("selection", { selected: selectedItems.length });

  const selected: DocHit[] = selectedItems.map(item => ({
    id: keyFromItem(item),
    score: item.score,
    text: item.text,
  }));

  const elapsedMs = nowMs() - start;
  return {
    query,
    language,
    expansions,
    selected,
    fused: fused.map(item => ({ id: keyFromItem(item), score: item.rrf })),
    budgetHit,
    elapsedMs,
  };
}

export function formatAnswerFromHits(hits: DocHit[]): string {
  return sanitizeText(hits.map(h => h.text).join("\n\n"));
}

export function sanitizeAnswer(text: string): string {
  if (!text) return "";
  let s = String(text);
  s = s.replace(/\u00ad/g, "");
  s = stripTatweel(s);
  s = s.replace(/[\r\t]/g, " ");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/^\s*[•–]\s+/gm, "- ");
  s = s.replace(/\s{3,}/g, " ");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
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
  items.forEach(it => {
    const t = truncate(it, maxLen);
    const key = normalizeForDedup(t);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  });
  return out.slice(0, maxItems);
}

function isBrandIntent(q: string): boolean {
  const t = String(q || "").toLowerCase();
  if (!t.includes("gasable")) return false;
  return /(what|who|about|profile|overview|services|company|mission|vision)\b/.test(t) || /\bhow\b/.test(t) || t.trim() === "gasable";
}

function isAboutIntent(q: string): boolean {
  const t = String(q || "").toLowerCase();
  return t.includes("gasable") && /(what\s+is|what'?s|whats|about|who\s+is|who'?s|overview|profile)\b/.test(t);
}

function isBrandServicesIntent(q: string): boolean {
  const t = String(q || "").toLowerCase();
  if (!t.includes("gasable")) return false;
  return /(list|services?|offerings?|solutions?|capabilities|products?|portfolio|catalog)/.test(t);
}

export interface StructuredSection {
  heading: string;
  bullets?: string[];
  paragraph?: string;
}

export interface StructuredAnswer {
  title: string;
  summary: string[];
  sections: StructuredSection[];
  sources: Array<{ id: string; label?: string }>;
}

export function buildStructuredFromHits(query: string, hits: DocHit[], title?: string): StructuredAnswer {
  const top = hits.slice(0, 6);
  const summary: string[] = [];
  const sections: StructuredSection[] = [];
  const sources = top.map(h => ({ id: h.id }));
  const titleText = title || truncate(query, 140);

  if (isAboutIntent(query) || isBrandIntent(query)) {
    const text = formatAnswerFromHits(top).slice(0, 4000);
    const lines = text.split(/\n+/).map(s => sanitizeText(s)).filter(Boolean);
    const services: string[] = [];
    const mission: string[] = [];
    const scale: string[] = [];
    const products: string[] = [];
    const support: string[] = [];
    for (const line of lines) {
      const low = line.toLowerCase();
      if (/\b(ev|charger|charging|delivery|diesel|lpg|iot|sensor|meter|solar|battery)\b/.test(low)) services.push(line);
      else if (/\bmission|vision|sustainab|award|recognition\b/.test(low)) mission.push(line);
      else if (/\b1\.5\s*million|\b3000\b|network|stations|partners|cities\b/.test(low)) scale.push(line);
      else if (/\bapp|portal|platform|marketplace|powerly|dashboard|mobile\b/.test(low)) products.push(line);
      else if (/\b24\/7|support|customer care|service\s*level|sla\b/.test(low)) support.push(line);
    }
    const norm = (arr: string[], n: number) => dedupeKeepTop(arr, n, 160);
    if (services.length) sections.push({ heading: "Services", bullets: norm(services, 6) });
    if (products.length) sections.push({ heading: "Products & Platforms", bullets: norm(products, 4) });
    if (support.length) sections.push({ heading: "Support", bullets: norm(support, 4) });
    if (scale.length) sections.push({ heading: "Scale & Network", bullets: norm(scale, 4) });
    if (mission.length) sections.push({ heading: "Mission & Recognition", bullets: norm(mission, 4) });
    if (!sections.length) sections.push({ heading: "Overview", paragraph: truncate(text, 1200) });
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
    .filter(s => s.length >= 30 && s.length <= 260);

  const qTokens = new Set(String(query).toLowerCase().split(/[^a-zA-Z0-9\u0600-\u06FF]+/).filter(t => t.length > 2));
  const scored = sentences
    .map(sentence => {
      const toks = new Set(sentence.toLowerCase().split(/[^a-zA-Z0-9\u0600-\u06FF]+/).filter(t => t.length > 2));
      let overlap = 0;
      toks.forEach(tok => { if (qTokens.has(tok)) overlap += 1; });
      return { sentence, overlap };
    })
    .sort((a, b) => b.overlap - a.overlap || b.sentence.length - a.sentence.length);

  summary.push(...dedupeKeepTop(scored.map(s => s.sentence), 5, 200));
  if (!summary.length && top[0]?.text) summary.push(truncate(top[0].text, 180));

  if (top.length) {
    sections.push({ heading: "Key Details", bullets: dedupeKeepTop(top.map(h => h.text), 6, 220) });
  }

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
  const llm = STRICT_CONTEXT_ONLY ? null : openai;
  if (!llm || !hits?.length) return buildStructuredFromHits(query, hits || []);

  const t0 = nowMs();
  const context = hits.slice(0, 8).map((h, i) => `[${i + 1}] ${truncate(h.text, 550)}`).join("\n\n");
  const schema = {
    title: "string",
    summary: ["string"],
    sections: [{ heading: "string", bullets: ["string"], paragraph: "string" }],
    sources: [{ id: "string", label: "string" }],
  };
  const sys = "You return ONLY strict JSON for a structured answer. No prose, no markdown, no code fences. Keep it concise, to-the-point, and well-organized. Use bullets only for lists and keep each bullet under 180 characters. Answer using ONLY the provided context.";
  const usr = `Question: ${query}\n\nContext:\n${context}\n\nReturn JSON with this schema (omit empty fields): ${JSON.stringify(schema)}\nRules:\n- title: short phrase.\n- summary: 4–8 crisp bullets.\n- sections: 1–3 helpful headings.\n- sources: map to [index] labels where possible.`;

  try {
    const comp = await llm.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: usr },
      ],
    });
    if (nowMs() - t0 > budgetMs) return buildStructuredFromHits(query, hits);
    const raw = comp.choices?.[0]?.message?.content || "{}";
    const jsonText = (raw.match(/\{[\s\S]*\}/) || [raw])[0];
    const parsed = JSON.parse(jsonText);
    const title = truncate(parsed.title || query, 140);
    const summary = Array.isArray(parsed.summary)
      ? parsed.summary.map((s: any) => truncate(String(s || ""), 260)).filter(Boolean)
      : [];
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
  } catch {
    return buildStructuredFromHits(query, hits);
  }
}

export async function lexicalFallback(
  pg: PgClient,
  query: string,
  limit: number,
  _preferDomain?: string | null
): Promise<DocHit[]> {
  const hits = await bm25Search(pg, query, limit);
  return hits.map(hit => ({
    id: keyFromItem(hit),
    score: hit.score,
    text: hit.text,
  }));
}
