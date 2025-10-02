/* Streaming hybrid RAG via Server-Sent Events */
;(process as any).env.PGSSLMODE = (process as any).env.PGSSLMODE || "require";

import OpenAI from "openai";
import { Client } from "pg";

import {
  DEFAULT_RAG_CONFIG,
  hybridRetrieve,
  sanitizeAnswer,
  formatAnswerFromHits,
  lexicalFallback,
  generateStructuredAnswer,
  structuredToHtml,
} from "./lib/rag";
import type { HybridConfig } from "./lib/rag";

type PgClient = {
  connect(): Promise<void>;
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
  end: () => Promise<void>;
};

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const ANSWER_MODEL = process.env.RERANK_MODEL || process.env.OPENAI_MODEL || "gpt-5-mini";
const STREAM_BUDGET_MS = Number(process.env.STREAM_BUDGET_MS || 8000);
const STREAM_TOP_K = Number(process.env.RAG_STREAM_TOP_K || 8);

let pgClient: PgClient | null = null;

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function markdownToHtmlSimple(md: string): string {
  if (!md) return "";
  const s = escapeHtml(md);
  const blocks = s.trim().split(/\n\s*\n/);
  const parts: string[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter(ln => ln.trim());
    const isList = lines.some(ln => /^\s*[-•]\s+/.test(ln));
    if (isList) {
      const bulletRe = /^\s*[-•]\s+/;
      const listHtml = lines.map(ln => "<li>" + ln.replace(bulletRe, "") + "</li>").join("");
      parts.push("<ul>" + listHtml + "</ul>");
    } else {
      parts.push("<p>" + lines.join(" ") + "</p>");
    }
  }
  return parts.join("\n");
}

function extractProjectRef(): string {
  const supaUrl = process.env.SUPABASE_URL || "";
  const m1 = supaUrl.match(/https?:\/\/([^.]+)\.supabase\.co/i);
  if (m1) return m1[1];
  const raw = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "";
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

// Ensure DSN opts out of TLS verification on platforms where CA bundles cause failures
function withNoVerify(dsn: string): string {
  try {
    const u = new URL(dsn.replace("postgres://", "postgresql://"));
    u.searchParams.set("sslmode", "no-verify");
    return u.toString();
  } catch {
    return dsn + (dsn.includes("?") ? "&" : "?") + "sslmode=no-verify";
  }
}

async function getPg(): Promise<PgClient> {
  if (pgClient) return pgClient;
  const raw = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  const primary = raw ? withNoVerify(raw) : "";
  if (!primary) throw new Error("DATABASE_URL not set");
  const tryConnect = async (conn: string) => {
    const c = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
    await c.connect();
    await c.query("SELECT 1");
    return c;
  };
  try {
    pgClient = await tryConnect(primary);
  } catch (err) {
    const msg = String(err || "");
    if (!/ENOTFOUND|EAI_AGAIN|self-signed certificate/i.test(msg)) throw err;
    for (const alt of poolerCandidates(primary)) {
      try {
        pgClient = await tryConnect(alt);
        break;
      } catch (_) {}
    }
    if (!pgClient) throw err;
  }
  return pgClient!;
}

function sse(controller: ReadableStreamDefaultController, event: string, payload: any) {
  controller.enqueue(new TextEncoder().encode(`event: ${event}\n`));
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
}

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const query = (url.searchParams.get("q") || "").trim();
  if (!query) return new Response("Missing q", { status: 400 });

  const stream = new ReadableStream({
    start: async (controller) => {
      const started = Date.now();
      const emitStep = (step: string, payload: Record<string, any> = {}) => {
        const elapsedMs = Date.now() - started;
        // Align labels with Python webapp process panel
        const stepMap: Record<string, string> = {
          expansions: "expansions",
          dense: "dense_retrieval",
          lexical: "lex_retrieval",
          keyword_prefilter: "keyword_prefilter",
          bm25: "bm25",
          fusion: "fusion",
          selection: "retrieval_done",
          selected_context: "selected_context",
          timeout_fallback: "timeout_fallback",
          answer_error: "answer_error",
        };
        const label = stepMap[step] || step;
        sse(controller, "step", { step: label, elapsedMs, ...payload });
      };
      const AR = /[\u0600-\u06FF]/;
      const hasAr = AR.test(query);
      const hasEn = /[A-Za-z]/.test(query);
      const initialLanguage = hasAr && hasEn ? "mixed" : (hasAr ? "ar" : "en");

      try {
        emitStep("received_query", { lang: initialLanguage });
        const pg = await getPg();

        const overrides: Partial<HybridConfig> = {};
        if (Number.isFinite(STREAM_TOP_K) && STREAM_TOP_K > 0) {
          overrides.finalK = STREAM_TOP_K;
          overrides.denseFuse = Math.max(DEFAULT_RAG_CONFIG.denseFuse, STREAM_TOP_K * 3);
        }
        // Match local Python defaults closely for recall/latency
        // Use fast, non-LLM expansions by default
        // Enforce Python parity: expansions=2
        overrides.expansions = 2;

        const effectiveFinalK = overrides.finalK || DEFAULT_RAG_CONFIG.finalK;

        let ragResult;
        try {
          // Allow a bit more budget to let dense+lexical finish, similar to webapp.py
          const timeLimitMs = Math.max(4000, Math.min(STREAM_BUDGET_MS + 3500, 15000));
          const retrieval = hybridRetrieve({
            query,
            pg,
            openai,
            reporter: (step, payload) => emitStep(step, payload),
            config: Object.keys(overrides).length ? overrides : undefined,
          });
          const timed = Promise.race([
            retrieval,
            new Promise<"TIMEOUT">(resolve => setTimeout(() => resolve("TIMEOUT"), timeLimitMs))
          ]);
          const res = await timed;
          if (res === "TIMEOUT") {
            emitStep("timeout_fallback", { budgetMs: timeLimitMs });
            const fallbackHits = await lexicalFallback(pg, query, effectiveFinalK, DEFAULT_RAG_CONFIG.preferDomainBoost);
            const hits = fallbackHits.map((hit, idx) => ({
              id: hit.id,
              score: Number(hit.score || 0),
              text: hit.text,
              order: idx + 1,
            }));
            // Try to produce a concise bullet answer like webapp.py even in fallback
            let raw = "";
            if (openai && hits.length) {
              const lang = initialLanguage;
              const context = hits.map(h => `[${h.order}] ${h.text}`).join("\n\n");
              try {
                const comp = await openai.chat.completions.create({
                  model: ANSWER_MODEL,
                  messages: [
                    { role: "system", content: "You are a precise bilingual assistant (English and Arabic) for Gasable. Ground every answer strictly in the given context and don't fabricate. Structure answers around customer needs: problem, relevant insights from context, and recommended next actions (bulleted)." },
                    { role: "user", content: `Language: ${lang}\nQuestion: ${query}\nContext:\n${context}\nUse ONLY the provided context. If context is insufficient or irrelevant, say one of: 'لا يتوفر سياق كافٍ' in Arabic or 'No relevant context available.' in English. You work for Gasable; keep tone factual. Remove OCR noise, join hyphenated words, and avoid repeating gibberish. Validate that the final answer is coherent and fully addresses the question; if not, refine succinctly once. Cite key facts concisely. Answer in the user's language.\nProvide a concise, accurate answer that includes: (1) customer need summary, (2) key evidence bullets with citations, (3) recommended next steps:` },
                  ],
                });
                raw = sanitizeAnswer(comp.choices?.[0]?.message?.content || "");
              } catch {
                raw = formatAnswerFromHits(fallbackHits);
              }
              if (!raw || !raw.trim()) {
                raw = formatAnswerFromHits(fallbackHits) || "No relevant context available.";
              }
            } else {
              raw = formatAnswerFromHits(fallbackHits);
            }
            const structured = await generateStructuredAnswer(openai, query, fallbackHits, STREAM_BUDGET_MS);
            const structured_html = structuredToHtml(structured);
            const answer_html = markdownToHtmlSimple(raw);
            sse(controller, "final", {
              query,
              hits: hits.map(h => ({ id: h.id, score: h.score })),
              answer: raw,
            answer_html,
              structured,
              structured_html,
              meta: { fallback: "timeout", language: initialLanguage },
            });
            return;
          }
          ragResult = res as any;
        } catch (err) {
          console.error("stream hybridRetrieve failed, using lexical fallback", err);
          const fallbackHits = await lexicalFallback(pg, query, effectiveFinalK, DEFAULT_RAG_CONFIG.preferDomainBoost);
          const hits = fallbackHits.map((hit, idx) => ({
            id: hit.id,
            score: Number(hit.score || 0),
            text: hit.text,
            order: idx + 1,
          }));
          emitStep("selected_context", { count: hits.length, fallback: "lexical" });
          // Use robust bullet prompt on lexical fallback
          let answer = "";
          if (openai && hits.length) {
            try {
              const context = hits.map(h => `[${h.order}] ${h.text}`).join("\n\n");
              const comp = await openai.chat.completions.create({
                model: ANSWER_MODEL,
                messages: [
                  { role: "system", content: "You are a precise bilingual assistant (English and Arabic) for Gasable. Ground every answer strictly in the given context and don't fabricate. Structure answers around customer needs: problem, relevant insights from context, and recommended next actions (bulleted)." },
                  { role: "user", content: `Language: ${initialLanguage}\nQuestion: ${query}\nContext:\n${context}\nUse ONLY the provided context. If context is insufficient or irrelevant, say one of: 'لا يتوفر سياق كافٍ' in Arabic or 'No relevant context available.' in English. You work for Gasable; keep tone factual. Remove OCR noise, join hyphenated words, and avoid repeating gibberish. Validate that the final answer is coherent and fully addresses the question; if not, refine succinctly once. Cite key facts concisely. Answer in the user's language.\nProvide a concise, accurate answer that includes: (1) customer need summary, (2) key evidence bullets with citations, (3) recommended next steps:` },
                ],
              });
              answer = sanitizeAnswer(comp.choices?.[0]?.message?.content || "");
            } catch {
              answer = formatAnswerFromHits(fallbackHits) || "No context available.";
            }
          } else {
            answer = formatAnswerFromHits(fallbackHits) || "No context available.";
          }
          const structured = await generateStructuredAnswer(openai, query, fallbackHits, STREAM_BUDGET_MS);
          const structured_html = structuredToHtml(structured);
          sse(controller, "final", {
            query,
            hits: hits.map(h => ({ id: h.id, score: h.score })),
            answer,
            answer_html: markdownToHtmlSimple(answer),
            structured,
            structured_html,
            meta: { fallback: "lexical", language: initialLanguage },
          });
          return;
        }

        const lang = ragResult.language;
        let hits = ragResult.selected.map((hit, idx) => ({
          id: hit.id,
          score: Number(hit.score || 0),
          text: hit.text,
          order: idx + 1,
        }));

        if (!hits.length) {
          const fallbackHits = await lexicalFallback(pg, query, effectiveFinalK, DEFAULT_RAG_CONFIG.preferDomainBoost);
          hits = fallbackHits.map((hit, idx) => ({
            id: hit.id,
            score: Number(hit.score || 0),
            text: hit.text,
            order: idx + 1,
          }));
          emitStep("selected_context", { count: hits.length, language: lang, fallback: "lexical_zero" });
        } else {
          emitStep("selected_context", { count: hits.length, language: lang });
        }

        let answer = "";
        const elapsedAfterRetrieve = Date.now() - started;
        if (!hits.length) {
          answer = "No context available.";
        } else if (elapsedAfterRetrieve > STREAM_BUDGET_MS) {
          answer = formatAnswerFromHits(ragResult.selected);
        } else if (openai) {
          const context = hits.map(h => `[${h.order}] ${h.text}`).join("\n\n");
          try {
            const comp = await openai.chat.completions.create({
              model: ANSWER_MODEL,
              messages: [
                {
                  role: "system",
                  content: "You are a precise bilingual assistant (English and Arabic) for Gasable. Use ONLY provided context. Output must be concise bullets (3–7), each ≤ 140 chars. Structure: 1) short need summary, 2) key evidence with citations [n], 3) recommended next actions. No fluff.",
                },
                {
                  role: "user",
                  content: `Language: ${lang}\nQuestion: ${query}\nContext:\n${context}\nRules:\n- Use ONLY the context; if insufficient, reply exactly: ${lang === "ar" ? "لا يتوفر سياق كافٍ" : "No relevant context available."}\n- Remove OCR noise and join hyphenated words.\n- Bullets only (no paragraphs), each ≤ 140 chars.\n- Include bracket citations like [1],[2] that refer to context order.\nReturn: bullets for (1) need summary, (2) key evidence, (3) next actions.`,
                },
              ],
            });
            answer = sanitizeAnswer(comp.choices?.[0]?.message?.content || "");
          } catch (err) {
            emitStep("answer_error", { error: String(err || "") });
            answer = formatAnswerFromHits(ragResult.selected);
          }
          if (!answer || !answer.trim()) {
            answer = formatAnswerFromHits(ragResult.selected) || "No relevant context available.";
          }
        } else {
          answer = formatAnswerFromHits(ragResult.selected);
        }

        // Emit final step marker for parity
        emitStep("answer_generated", { duration_ms: Date.now() - started, meta: { chars: (answer||"").length } });

        const structured = await generateStructuredAnswer(openai, query, hits.map(h => ({ id: h.id, score: h.score, text: h.text } as any)), STREAM_BUDGET_MS);
        const structured_html = structuredToHtml(structured);
        const response = {
          query,
          hits: hits.map(h => ({ id: h.id, score: h.score })),
          answer,
          answer_html: markdownToHtmlSimple(answer),
          structured,
          structured_html,
          meta: {
            language: lang,
            expansions: ragResult.expansions,
            budgetHit: ragResult.budgetHit,
            elapsedMs: ragResult.elapsedMs,
          },
        };
        sse(controller, "final", response);
      } catch (err: any) {
        sse(controller, "final", { error: err?.message || String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
    },
  });
};
