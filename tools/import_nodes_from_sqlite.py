import os
import re
import json
import sqlite3
import httpx
from typing import Any, Dict, List

# Map n8n-mcp nodes to our NodeSpec
# We use a generic python impl proxy for now so the nodes appear in the catalog

def _sanitize_leaf(node_type: str) -> str:
    leaf = node_type.split(".")[-1].lower()
    # Remove common suffixes that leak n8n semantics
    leaf = re.sub(r"trigger$", "", leaf)
    leaf = re.sub(r"workflow$", "", leaf)
    return re.sub(r"[^a-z0-9_]+", "_", leaf) or "node"


def to_spec(row: sqlite3.Row) -> Dict[str, Any]:
    node_type = row["node_type"] or "node"
    leaf = _sanitize_leaf(node_type)
    # Use a neutral provider/action; no n8n affiliation in name
    name = f"{leaf}.{leaf}"
    title = row["display_name"] or node_type
    category = row["category"] or "Catalog"
    description = row["description"] or ""
    # Minimal IO so UI can list it; detailed properties can be added later
    spec = {
        "name": name,
        "version": "1.0.0",
        "title": title,
        "category": category,
        "doc": description,
        "auth": {"type": "none", "provider": None, "scopes": []},
        "inputs": {},
        "outputs": {"response": {"type": "object"}},
        "rate_limit": {"unit": "minute", "limit": 60},
        "retries": {"max": 3, "backoff": "exponential", "max_delay_sec": 30},
        # Use our internal generic proxy (non-n8n) until specific logic is implemented
        "impl": {"type": "python", "module": "gasable_nodes.plugins.catalog.proxy", "function": "run"},
    }
    return spec

async def main() -> None:
    api_base = os.environ.get("GASABLE_API_BASE", "http://127.0.0.1:8000").rstrip("/")
    db_path = os.path.expanduser(os.environ.get("N8N_MCP_DB", "~/n8n-mcp/data/nodes.db"))
    limit = int(os.environ.get("MAX_NODES", "500"))

    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    rows = cur.execute(
        "select node_type, package_name, display_name, description, category from nodes order by node_type limit ?",
        (limit,),
    ).fetchall()

    specs: List[Dict[str, Any]] = [to_spec(r) for r in rows]

    async with httpx.AsyncClient(timeout=60) as http:
        # Install in chunks to avoid large payloads
        total = 0
        chunk = int(os.environ.get("BATCH", "200"))
        for i in range(0, len(specs), chunk):
            batch = specs[i : i + chunk]
            resp = await http.post(f"{api_base}/api/nodes/install", json={"specs": batch})
            if resp.status_code >= 400:
                raise RuntimeError(f"install failed: {resp.status_code} {resp.text[:200]}")
            total += len(batch)
            print(f"Installed nodes: {total}")

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
