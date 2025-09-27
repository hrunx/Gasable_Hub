import { Handler } from "@netlify/functions";
import OpenAI from "openai";
import { Client as PgClientRaw } from "pg";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

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

async function getPg(): Promise<PgClient> {
  const dsn = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "";
  if (!dsn) throw new Error("DATABASE_URL not set");
  const c = new PgClientRaw({ connectionString: dsn, ssl: { rejectUnauthorized: false } });
  await c.connect();
  return c as unknown as PgClient;
}

export const handler: Handler = async (event) => {
  // Streamable HTTP transport over Netlify Request/Response
  const server = new McpServer({ name: "gasable-mcp", version: "1.0.0" });

  // Tools
  server.tool("vector.query", {
    description: "Hybrid RAG query against Gasable index. Returns hits and structured answer.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string" },
        k: { type: "number" },
      },
      required: ["q"],
    },
    handler: async ({ q, k }) => {
      const pg = await getPg();
      try {
        const overrides: Partial<any> = {};
        if (Number.isFinite(k) && k > 0) {
          overrides.finalK = k;
          overrides.denseFuse = Math.max(DEFAULT_RAG_CONFIG.denseFuse, Number(k) * 3);
        }
        let result;
        try {
          result = await hybridRetrieve({ query: q, pg, openai, config: overrides });
        } catch {
          const fallback = await lexicalFallback(pg, q, overrides.finalK || DEFAULT_RAG_CONFIG.finalK, DEFAULT_RAG_CONFIG.preferDomainBoost);
          const structured = await generateStructuredAnswer(openai, q, fallback, DEFAULT_RAG_CONFIG.budgetMs);
          return {
            content: [{ type: "json", json: { query: q, hits: fallback, structured, structured_html: structuredToHtml(structured), meta: { fallback: "lexical" } } }],
          };
        }
        const hits = result.selected;
        const structured = await generateStructuredAnswer(openai, q, hits, DEFAULT_RAG_CONFIG.budgetMs);
        return {
          content: [{ type: "json", json: { query: q, hits, structured, structured_html: structuredToHtml(structured), meta: { expansions: result.expansions, budgetHit: result.budgetHit, elapsedMs: result.elapsedMs } } }],
        };
      } finally {
        try { await pg.end(); } catch {}
      }
    },
  });

  // Wire transport
  const transport = new StreamableHTTPServerTransport(event as any);
  await server.connect(transport);
  const response = await transport.finalize();
  return response as any;
};


