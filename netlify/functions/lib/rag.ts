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
const EMBED_COL = (process.env.PG_EMBED_COL || "embedding").replace(/[^a-zA-Z0-9_]/g, "");
const STRICT_CONTEXT_ONLY = String(process.env.STRICT_CONTEXT_ONLY || "true").toLowerCase() !== "false";
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

function sanitizeText(text: string): string {
  if (!text) return "";
  let s = String(text);
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/!\[[^\]]*\]\([^\)]*\)/g, " ");
  s = s.replace(/\[([^\]]*)\]\([^\)]*\)/g, (_m, p1) => p1 || "");
  s = s.replace(/https:\s+/g, "https://").replace(/http:\s+/g, "http://");
  s = s.replace(/\s{2,}/g, " ");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
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
  return Array.from(out).filter(Boolean);
}

async function generateExpansions(
  openai: OpenAI | null,
  query: string,
  maxExpansions: number,
  budgetMs: number
): Promise<string[]> {
  const base = sanitizeText(query);
  const fallback = [base, ...naiveExpansions(base)].filter(Boolean).slice(0, maxExpansions);
  if (!openai) return fallback.length ? fallback : [query];

  const start = nowMs();
  try {
    const sys = "You produce only a JSON array of search queries. Include Arabic variants if helpful. No text outside JSON.";
    const resp = await openai.chat.completions.create({
      model: process.env.RERANK_MODEL || process.env.OPENAI_MODEL || "gpt-5-mini",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: `Original: ${query}\nReturn up to ${maxExpansions} concise search queries as a JSON array.` },
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
        push(String(item || ""));
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
  const sql = `
    SELECT node_id,
           left(COALESCE(text, li_metadata->>'chunk'), 2000) AS text,
           li_metadata,
           ts_rank_cd(tsv, plainto_tsquery('simple', $1)) AS score
    FROM ${SCHEMA}.${TABLE}
    WHERE tsv @@ plainto_tsquery('simple', $1)
    ORDER BY score DESC
    LIMIT $2`;
  try {
    const { rows } = await pg.query(sql, [query, limit]);
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
  if (id.startsWith(prefer)) return 1;
  if (prefer.startsWith("web://") && id.startsWith("web://")) return 0.5;
  return 0;
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
  const expansions = await generateExpansions(openai, query, Math.max(1, config.expansions), config.budgetMs);
  reporter?.("expansions", { count: expansions.length, expansions });

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
                  1 - (${EMBED_COL} <=> $1::vector) AS score
           FROM ${SCHEMA}.${TABLE}
           ORDER BY ${EMBED_COL} <=> $1::vector
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
    }
  }
  reporter?.("dense", { lists: denseLists.length });

  for (const exp of expansions) {
    if (nowMs() - start > config.budgetMs) { budgetHit = true; break; }
    const tokens = String(exp || "")
      .split(/\s+/)
      .map(t => t.trim())
      .filter(t => t.length > 2)
      .slice(0, 6);
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
    bm25Hits = await bm25Search(pg, query, config.denseFuse);
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

  candidates.sort((a, b) => {
    const ba = applyDomainBoost(a.id, config.preferDomainBoost);
    const bb = applyDomainBoost(b.id, config.preferDomainBoost);
    if (ba !== bb) return bb - ba;
    return b.score - a.score;
  });

  let selected = simpleMMR(candidates, config.finalK, config.mmrLambda);
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

export function buildStructuredFromHits(query: string, hits: DocHit[], title?: string): StructuredAnswer {
  const top = hits.slice(0, 6);
  const summary: string[] = [];
  const sections: StructuredSection[] = [];
  const sources = top.map(h => ({ id: h.id }));
  const titleText = title || truncate(query, 140);

  // Naive extraction: take first lines as bullets
  const joined = formatAnswerFromHits(top).split(/\n+/).filter(Boolean);
  joined.slice(0, 6).forEach(line => {
    const s = line.replace(/^[-•\u2022\s]+/, "").trim();
    if (s) summary.push(s);
  });

  if (!summary.length) {
    summary.push(truncate(top[0]?.text || "No context available."));
  }

  sections.push({ heading: "Details", paragraph: truncate(joined.join(" \n"), 1200) });

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
  const context = hits.slice(0, 8).map((h, i) => `[${i + 1}] ${truncate(h.text, 900)}`).join("\n\n");
  const schema = {
    title: "string",
    summary: ["string"],
    sections: [{ heading: "string", bullets: ["string"], paragraph: "string" }],
    sources: [{ id: "string", label: "string" }],
  };
  const sys = "You return ONLY strict JSON for a structured answer. No prose, no markdown, no code fences. Keep it concise and well-organized. Use bullets only for lists.";
  const usr = `Question: ${query}\n\nContext:\n${context}\n\nReturn JSON with this schema (omit empty fields): ${JSON.stringify(schema)}\nRules:\n- title: short phrase.\n- summary: 4–8 crisp bullets.\n- sections: 1–3 with helpful headings, use bullets only when natural.\n- sources: map to [index] if possible using labels like "+ [1] excerpt".`;

  try {
    const comp = await llm.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: usr },
      ],
      temperature: 0.2,
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
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2)
    .slice(0, 8);
  const scoreExpr = tokens
    .map((_, idx) => `CASE WHEN COALESCE(text, li_metadata->>'chunk') ILIKE $${idx + 1} THEN 1 ELSE 0 END`)
    .join(' + ') || '0';
  const params = tokens.map(t => `%${t}%`);
  const cap = Math.max(1, Math.min(limit || DEFAULTS.finalK, 24));

  const preferLike = preferDomain ? `${preferDomain}%` : null;

  const runQuery = async (extraCond?: string, extraParam?: string) => {
    let sql = `
      SELECT node_id,
             left(COALESCE(text, li_metadata->>'chunk'), 2000) AS text,
             li_metadata,
             (${scoreExpr}) AS score_calc
      FROM ${SCHEMA}.${TABLE}
    `;
    const values: any[] = params.slice();
    if (extraCond && extraParam) {
      sql += `WHERE ${extraCond}\n`;
      values.push(extraParam);
    }
    sql += `ORDER BY score_calc DESC, length(COALESCE(text, li_metadata->>'chunk')) DESC LIMIT $${values.length + 1}`;
    values.push(cap);
    const { rows } = await pg.query(sql, values);
    return rows.map((r: any) => ({
      id: r.node_id,
      score: Number(r.score_calc || 0),
      text: sanitizeText(r.text || ""),
      metadata: r.li_metadata,
    }));
  };

  try {
    if (preferLike) {
      const preferHits = await runQuery(`node_id LIKE $${params.length + 1}`, preferLike);
      if (preferHits.length) return preferHits;
    }
  } catch (err) {
    console.warn('lexicalFallback prefer domain failed', err);
  }

  try {
    const hits = await runQuery();
    if (hits.length) return hits;
  } catch (err) {
    console.warn('lexicalFallback base query failed', err);
  }

  // As a last resort use trigram similarity if available
  try {
    const like = preferLike || '%';
    const sql = `
      SELECT node_id,
             left(COALESCE(text, li_metadata->>'chunk'), 2000) AS text,
             li_metadata,
             similarity(COALESCE(text, li_metadata->>'chunk'), $2) AS sim
      FROM ${SCHEMA}.${TABLE}
      WHERE node_id LIKE $1 AND COALESCE(text, li_metadata->>'chunk') % $2
      ORDER BY sim DESC
      LIMIT $3`;
    const { rows } = await pg.query(sql, [like, query, cap]);
    if (rows.length) {
      return rows.map((r: any) => ({
        id: r.node_id,
        score: Number(r.sim || 0),
        text: sanitizeText(r.text || ""),
        metadata: r.li_metadata,
      }));
    }
  } catch (err) {
    console.warn('lexicalFallback trigram failed', err);
  }

  try {
    const sql = `
      SELECT node_id,
             left(COALESCE(text, li_metadata->>'chunk'), 2000) AS text,
             li_metadata
      FROM ${SCHEMA}.${TABLE}
      WHERE COALESCE(text, li_metadata->>'chunk') % $1
      ORDER BY similarity(COALESCE(text, li_metadata->>'chunk'), $1) DESC
      LIMIT $2`;
    const { rows } = await pg.query(sql, [query, cap]);
    return rows.map((r: any) => ({
      id: r.node_id,
      score: 0,
      text: sanitizeText(r.text || ""),
      metadata: r.li_metadata,
    }));
  } catch (err) {
    console.warn('lexicalFallback final similarity failed', err);
  }

  return [];
}
