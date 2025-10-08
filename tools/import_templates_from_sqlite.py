import os
import sys
import json
import gzip
import base64
import sqlite3
import httpx
import asyncio
from typing import Any, Dict, List, Optional


def decode_workflow(row: sqlite3.Row) -> Optional[Dict[str, Any]]:
    raw = row["workflow_json"]
    if not raw:
        enc = row["workflow_json_compressed"]
        if enc:
            try:
                raw = gzip.decompress(base64.b64decode(enc)).decode("utf-8")
            except Exception:
                raw = None
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def to_graph(workflow: Dict[str, Any]) -> Dict[str, Any]:
    nodes: List[Dict[str, Any]] = []
    edges: List[Dict[str, Any]] = []

    if not isinstance(workflow, dict):
        return {"nodes": nodes, "edges": edges}

    wf_nodes = workflow.get("nodes") or []
    # Some templates store nodes as list of dicts; defensive check
    if isinstance(wf_nodes, list):
        for n in wf_nodes:
            if not isinstance(n, dict):
                continue
            # Use node name as ID to align with n8n connections (which reference names)
            node_id = str(n.get("name") or n.get("id") or len(nodes))
            pos = n.get("position") or {}
            x = 0.0
            y = 0.0
            if isinstance(pos, dict):
                xv = pos.get("x")
                yv = pos.get("y")
                x = float(xv) if isinstance(xv, (int, float)) else 0.0
                y = float(yv) if isinstance(yv, (int, float)) else 0.0
            elif isinstance(pos, (list, tuple)) and len(pos) >= 2:
                try:
                    x = float(pos[0])
                except Exception:
                    x = 0.0
                try:
                    y = float(pos[1])
                except Exception:
                    y = 0.0
            label = n.get("name") or n.get("type") or node_id
            tool_name = n.get("type") or label
            nodes.append(
                {
                    "id": node_id,
                    "type": "toolNode",
                    "position": {"x": x, "y": y},
                    "data": {"label": label, "toolName": tool_name},
                }
            )

    conns = workflow.get("connections") or {}
    # n8n connections are usually a dict: { sourceNodeName: { outputName: [ { node: targetName, ... }, ... ] } }
    if isinstance(conns, dict):
        for src_name, outputs in conns.items():
            if not isinstance(outputs, dict):
                continue
            for _out, arr in outputs.items():
                if isinstance(arr, list):
                    for c in arr:
                        if isinstance(c, dict):
                            tgt = c.get("node") or c.get("name")
                            if tgt:
                                edges.append(
                                    {
                                        "id": f"{src_name}->{tgt}",
                                        "source": str(src_name),
                                        "target": str(tgt),
                                    }
                                )

    return {"nodes": nodes, "edges": edges}


async def main() -> None:
    api_base = os.environ.get("GASABLE_API_BASE", "http://127.0.0.1:8000").rstrip("/")
    db_path = os.path.expanduser(os.environ.get("N8N_MCP_DB", "~/n8n-mcp/data/nodes.db"))

    if not os.path.exists(db_path):
        print(f"SQLite not found: {db_path}", file=sys.stderr)
        sys.exit(1)

    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    total = cur.execute("select count(*) from templates").fetchone()[0]
    print(f"Templates in SQLite: {total}")

    batch_size = int(os.environ.get("IMPORT_BATCH", "100"))
    max_templates = int(os.environ.get("MAX_TEMPLATES", "0"))  # 0 means all
    offset = int(os.environ.get("RESUME_OFFSET", "0"))
    imported = 0

    limits = httpx.Limits(max_keepalive_connections=5, max_connections=5)
    delay_ms = int(os.environ.get("RATE_LIMIT_DELAY_MS", "5"))
    async with httpx.AsyncClient(timeout=30, limits=limits) as http:
        while True:
            rows = cur.execute(
                "select id, workflow_id, name, description, categories, workflow_json, workflow_json_compressed from templates order by id limit ? offset ?",
                (batch_size, offset),
            ).fetchall()
            if not rows:
                break

            for r in rows:
                wf = decode_workflow(r)
                graph = to_graph(wf or {})
                try:
                    cats = json.loads(r["categories"]) if r["categories"] else []
                except Exception:
                    cats = []
                category = cats[0] if cats else "General"

                body = {
                    "slug": f"n8n-{r['workflow_id']}",
                    "name": r["name"],
                    "description": r["description"] or "",
                    "category": category,
                    "graph": graph,
                    "source": "n8n-mcp-sqlite",
                }
                # Retry up to 3 times on network or 5xx
                attempts = 0
                while True:
                    attempts += 1
                    try:
                        resp = await http.post(
                            f"{api_base}/api/templates/install",
                            json=body,
                            headers={"Connection": "close"},
                        )
                    except httpx.RequestError as e:
                        if attempts < 3:
                            print(f"Install error (network) slug={body['slug']} attempt={attempts}: {e}", file=sys.stderr)
                            await asyncio.sleep(0.5)
                            continue
                        else:
                            print(f"Install error (network, giving up) slug={body['slug']}: {e}", file=sys.stderr)
                            break
                    if resp.status_code >= 500:
                        if attempts < 3:
                            print(f"Install failed (5xx) slug={body['slug']} status={resp.status_code} attempt={attempts}", file=sys.stderr)
                            await asyncio.sleep(0.5)
                            continue
                        else:
                            print(f"Install failed (5xx, giving up) slug={body['slug']} status={resp.status_code}", file=sys.stderr)
                            break
                    if resp.status_code >= 400:
                        txt = resp.text
                        print(f"Install failed (4xx) slug={body['slug']} status={resp.status_code} body={txt[:200]}", file=sys.stderr)
                        break
                    # success
                    imported += 1
                    if delay_ms:
                        await asyncio.sleep(delay_ms / 1000.0)
                    if max_templates and imported >= max_templates:
                        print(f"Imported {imported} (limit reached)")
                        print("Done.")
                        return
                    break

            offset += len(rows)
            print(f"Imported {imported}/{total}")

    print(f"Done. Imported {imported} templates.")


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())


