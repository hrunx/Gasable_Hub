export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) return new Response("Missing q", { status: 400 });

  const upstreamUrl = new URL("/.netlify/functions/query_stream", url.origin);
  upstreamUrl.searchParams.set("q", q);

  try {
    const upstream = await fetch(upstreamUrl.toString(), {
      method: "GET",
      headers: { "accept": "text/event-stream" },
    });

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => "");
      const body = `event: final\n` +
                   `data: ${JSON.stringify({ error: `upstream ${upstream.status}`, details: errText })}\n\n`;
      return new Response(body, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          "connection": "keep-alive",
          "access-control-allow-origin": "*",
        },
      });
    }

    return new Response(upstream.body, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "connection": "keep-alive",
        "access-control-allow-origin": "*",
      },
    });
  } catch (e: any) {
    const body = `event: final\n` +
                 `data: ${JSON.stringify({ error: e?.message || String(e) })}\n\n`;
    return new Response(body, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "connection": "keep-alive",
        "access-control-allow-origin": "*",
      },
    });
  }
};


