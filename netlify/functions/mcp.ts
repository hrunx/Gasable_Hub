import { Handler } from "@netlify/functions";
import OpenAI from "openai";
import { Client as PgClientRaw } from "pg";
// Note: SDK is installed; for Netlify we implement a minimal JSON-RPC over HTTP
// and can switch to StreamableHTTPServerTransport when native req/res are available.
import {
  DEFAULT_RAG_CONFIG,
  hybridRetrieve,
  lexicalFallback,
  structuredToHtml,
  generateStructuredAnswer,
} from "./lib/rag";

type PgClient = {
  connect(): Promise<void>;
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
  end: () => Promise<void>;
};

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

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
  const raw = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "";
  if (!raw) throw new Error("DATABASE_URL not set");
  const dsn = withNoVerify(raw);
  const c = new PgClientRaw({ connectionString: dsn, ssl: { rejectUnauthorized: false } });
  await c.connect();
  return c as unknown as PgClient;
}

export const handler: Handler = async (event) => {
  // Minimal JSON-RPC 2.0 over HTTP to interop with MCP tools/call and tools/list
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const id = body.id ?? null;
    const method = body.method || "";
    const params = body.params || {};

    const json = async (result: any) => ({ statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, result }) });
    const error = async (code: number, message: string) => ({ statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) });

    if (method === "tools/list") {
      return json({
        tools: [
          {
            name: "vector.query",
            description: "Hybrid RAG query against Gasable index. Returns hits and structured answer.",
            inputSchema: { type: "object", properties: { q: { type: "string" }, k: { type: "number" } }, required: ["q"] },
          },
        ],
      });
    }

    if (method === "tools/call") {
      const name = params.name;
      const args = params.arguments || {};
      if (name !== "vector.query") return error(-32601, `Unknown tool: ${name}`);
      const q = String(args.q || "");
      const k = Number(args.k || 0);
      if (!q) return error(-32602, "Missing q");
      const pg = await getPg();
      try {
        const overrides: Partial<any> = {};
        if (Number.isFinite(k) && k > 0) {
          overrides.finalK = k;
          overrides.denseFuse = Math.max(DEFAULT_RAG_CONFIG.denseFuse, Number(k) * 3);
        }
        try {
          const result = await hybridRetrieve({ query: q, pg, openai, config: overrides });
          const hits = result.selected;
          const structured = await generateStructuredAnswer(openai, q, hits, DEFAULT_RAG_CONFIG.budgetMs);
          return json({ content: [{ type: "json", json: { query: q, hits, structured, structured_html: structuredToHtml(structured), meta: { expansions: result.expansions, budgetHit: result.budgetHit, elapsedMs: result.elapsedMs } } }] });
        } catch (e) {
          const fallback = await lexicalFallback(pg, q, overrides.finalK || DEFAULT_RAG_CONFIG.finalK, DEFAULT_RAG_CONFIG.preferDomainBoost);
          const structured = await generateStructuredAnswer(openai, q, fallback, DEFAULT_RAG_CONFIG.budgetMs);
          return json({ content: [{ type: "json", json: { query: q, hits: fallback, structured, structured_html: structuredToHtml(structured), meta: { fallback: "lexical" } } }] });
        }
      } finally {
        try { await pg.end(); } catch {}
      }
    }

    return error(-32601, "Method not found");
  } catch (e: any) {
    return { statusCode: 500, body: String(e?.message || e) };
  }
};


