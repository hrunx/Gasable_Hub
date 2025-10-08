import asyncio, json, httpx, os
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

API_BASE = os.environ.get("GASABLE_API_BASE", "http://127.0.0.1:8000")
N8N_MCP_URL = os.environ.get("N8N_MCP_URL", "http://127.0.0.1:3000/mcp")


async def main():
    # Pass Authorization header if AUTH_TOKEN is provided (required by n8n-mcp HTTP mode)
    headers = {}
    token = (os.environ.get("AUTH_TOKEN") or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"

    async with streamablehttp_client(N8N_MCP_URL, headers=headers) as (r, w, _):
        async with ClientSession(r, w) as sess:
            await sess.initialize()

            tools = await sess.list_tools()
            tool_names = [t.name for t in tools.tools]
            if "list_nodes" not in tool_names:
                raise SystemExit("n8n-mcp missing list_nodes; run it in HTTP mode")

            nodes = []
            offset = 0
            while True:
                res = await sess.call_tool("list_nodes", arguments={"limit": 200, "offset": offset})
                chunk = json.loads(res.content[0].text)
                nodes += chunk.get("items", [])
                if len(chunk.get("items", [])) < 200:
                    break
                offset += 200

            specs = []
            for n in nodes:
                name = f"{(n.get('package') or 'n8n').lower().replace(' ','_')}.{(n.get('name') or 'node').lower().replace(' ','_')}"
                specs.append({
                    "name": name,
                    "version": "1.0.0",
                    "title": n.get("displayName") or n.get("name") or name,
                    "category": n.get("category") or "n8n",
                    "doc": n.get("description", ""),
                    "auth": {"type": "none", "provider": None, "scopes": []},
                    "inputs": n.get("inputsSchema", {}) or {},
                    "outputs": {"response": {"type": "object"}},
                    "rate_limit": {"unit": "minute", "limit": 60},
                    "retries": {"max": 5, "backoff": "exponential", "max_delay_sec": 30},
                    "impl": {"type": "python", "module": "gasable_nodes.plugins.n8n.proxy", "function": "run"},
                })

            async with httpx.AsyncClient(timeout=300) as http:
                if specs:
                    # Chunk install to avoid payload/timeouts
                    total = 0
                    for i in range(0, len(specs), 200):
                        batch = specs[i:i+200]
                        r = await http.post(f"{API_BASE}/api/nodes/install", json={"specs": batch})
                        r.raise_for_status()
                        total += len(batch)
                    print("Installed nodes:", total)

            # Templates import (paginated, limit<=50, with required nodeTypes)
            total_tpl = 0
            if "list_node_templates" in tool_names:
                try:
                    t_offset = 0
                    async with httpx.AsyncClient(timeout=600) as http:
                        while True:
                            res = await sess.call_tool(
                                "list_node_templates",
                                arguments={"limit": 50, "offset": t_offset, "nodeTypes": ["workflow", "ai-workflow"]},
                            )
                            page = json.loads(res.content[0].text)
                            items = page.get("items", [])
                            if not items:
                                break
                            for t in items:
                                try:
                                    tpl = await sess.call_tool("get_template", arguments={"id": t["id"]})
                                    tpl_json = json.loads(tpl.content[0].text)
                                    body = {
                                        "slug": t.get("slug") or str(t.get("id")),
                                        "name": t.get("name", "Template"),
                                        "description": t.get("description", ""),
                                        "category": t.get("category", "General"),
                                        "graph": {"nodes": tpl_json.get("nodes", []), "edges": tpl_json.get("connections", [])},
                                        "source": "n8n-mcp",
                                    }
                                    r = await http.post(f"{API_BASE}/api/templates/install", json=body)
                                    r.raise_for_status()
                                    total_tpl += 1
                                except Exception:
                                    pass
                            if len(items) < 50:
                                break
                            t_offset += 50
                    print("Imported templates:", total_tpl)
                except Exception as e:
                    print("Template import skipped:", e)


if __name__ == "__main__":
    asyncio.run(main())


