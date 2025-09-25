/* SSE relay for background RAG jobs
   GET /.netlify/functions/query_events?id=<jobId>
   Streams steps as they update and ends with final result.
*/
import { Client } from "pg";

type PgClient = {
  connect(): Promise<void>;
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
  end: () => Promise<void>;
};

async function getPg(): Promise<PgClient> {
  const conn = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "";
  const c = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  await c.connect();
  return c as unknown as PgClient;
}

function sse(controller: ReadableStreamDefaultController, event: string, payload: any) {
  const line = `event: ${event}\n` + `data: ${JSON.stringify(payload)}\n\n`;
  controller.enqueue(new TextEncoder().encode(line));
}

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const id = (url.searchParams.get("id") || "").trim();
  if (!id) return new Response("Missing id", { status: 400 });

  const pg = await getPg();

  const stream = new ReadableStream({
    start: async (controller) => {
      try {
        let lastCount = 0;
        // poll every 800ms up to 5 minutes
        for (let i=0; i<375; i++) {
          const { rows } = await pg.query(`SELECT status, steps, result FROM public.jobs WHERE id=$1`, [id]);
          if (!rows.length) {
            sse(controller, "final", { error: "job not found" });
            break;
          }
          const row = rows[0];
          const steps = Array.isArray(row.steps) ? row.steps : []; 
          if (steps.length > lastCount) {
            for (let j=lastCount; j<steps.length; j++) sse(controller, "step", steps[j]);
            lastCount = steps.length;
          }
          if (row.status === 'done') {
            sse(controller, "final", row.result || { error: "no result" });
            break;
          }
          await new Promise(r => setTimeout(r, 800));
        }
      } catch (err: any) {
        sse(controller, "final", { error: String(err?.message || err) });
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


