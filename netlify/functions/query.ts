// Ensure SSL but allow poolers with no-verify if configured upstream
;(process as any).env.PGSSLMODE = (process as any).env.PGSSLMODE || "require";

import type { Handler } from "@netlify/functions";
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

let pgClient: PgClient | null = null;

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
    // Keep existing params but enforce no-verify for compatibility with Netlify builds
    u.searchParams.set("sslmode", "no-verify");
    return u.toString();
  } catch {
    return dsn + (dsn.includes("?") ? "&" : "?") + "sslmode=no-verify";
  }
}

async function getPg(): Promise<PgClient> {
  if (pgClient) return pgClient;
  const raw = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  const primary = raw ? withNoVerify(raw) : undefined;
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

function parseBody(body: string | null): any {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

export const handler: Handler = async (event) => {
  if ((event.httpMethod || "").toUpperCase() !== "POST") {
    return { statusCode: 405, body: "POST only" };
  }

  const payload = parseBody(event.body || "");
  const query = String(payload.q || "").trim();
  const requestedK = Number(payload.k);
  const withAnswer = payload.withAnswer !== false;
  if (!query) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing q" }) };
  }

  try {
    const pg = await getPg();
    const overrides: Partial<HybridConfig> = {};
    if (Number.isFinite(requestedK) && requestedK > 0) {
      overrides.finalK = requestedK;
      overrides.denseFuse = Math.max(DEFAULT_RAG_CONFIG.denseFuse, requestedK * 3);
    }

    const effectiveFinalK = overrides.finalK || DEFAULT_RAG_CONFIG.finalK;

    let ragResult;
    try {
      ragResult = await hybridRetrieve({
        query,
        pg,
        openai,
        config: Object.keys(overrides).length ? overrides : undefined,
      });
    } catch (err) {
      console.error("hybridRetrieve failed, using lexical fallback", err);
      const fallbackHits = await lexicalFallback(pg, query, effectiveFinalK, DEFAULT_RAG_CONFIG.preferDomainBoost);
      const hits = fallbackHits.map(hit => ({
        id: hit.id,
        score: Number(hit.score || 0),
        text: hit.text,
        metadata: hit.metadata,
      }));
      const answer = withAnswer ? (formatAnswerFromHits(fallbackHits) || "No context available.") : undefined;
      const structured = await generateStructuredAnswer(openai, query, fallbackHits, DEFAULT_RAG_CONFIG.budgetMs);
      const structured_html = structuredToHtml(structured);
      const answer_html = answer ? String(answer).replace(/\n/g, '<br>') : undefined;
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query,
          hits,
          answer,
          answer_html,
          structured,
          structured_html,
          meta: {
            fallback: "lexical",
          },
        }),
      };
    }

    const hits = ragResult.selected.map(hit => ({
      id: hit.id,
      score: Number(hit.score || 0),
      text: hit.text,
      metadata: hit.metadata,
    }));

    let answer: string | undefined;
    if (withAnswer) {
      if (!hits.length) {
        answer = "No context available.";
      } else if (openai) {
        const context = hits.map((h, i) => `[${i + 1}] ${h.text}`).join("\n\n");
        try {
          const comp = await openai.chat.completions.create({
            model: ANSWER_MODEL,
            messages: [
              { role: "system", content: "Role: Senior consultant for energy and EV infrastructure. Use ONLY the provided context. Be precise, structured, and actionable. Prefer short paragraphs; use bullets only for lists. If context is insufficient, reply exactly: 'No context available.'" },
              { role: "user", content: `Question: ${query}\n\nContext:\n${context}` },
            ],
          });
          answer = sanitizeAnswer(comp.choices?.[0]?.message?.content || "");
        } catch (err) {
          console.warn("LLM answer failed, falling back to raw context", err);
          answer = formatAnswerFromHits(ragResult.selected);
        }
      } else {
        answer = formatAnswerFromHits(ragResult.selected) || "No context available.";
      }
    }

    // Structured answer (always attempt, falls back internally)
    const structured = await generateStructuredAnswer(openai, query, ragResult.selected, DEFAULT_RAG_CONFIG.budgetMs);
    const structured_html = structuredToHtml(structured);
    const answer_html = answer ? String(answer).replace(/\n/g, '<br>') : undefined;

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query,
        hits,
        answer,
        answer_html,
        structured,
        structured_html,
        meta: {
          expansions: ragResult.expansions,
          budgetHit: ragResult.budgetHit,
          elapsedMs: ragResult.elapsedMs,
        },
      }),
    };
  } catch (err: any) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err?.message || "error" }) };
  }
};
