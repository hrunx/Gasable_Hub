import os, json, sqlite3, pathlib, argparse, re

OUT_NODES = pathlib.Path("generated_nodes/n8n"); OUT_NODES.mkdir(parents=True, exist_ok=True)


def snake(s):
    return re.sub(r"[^a-z0-9]+", "_", (s or "").lower()).strip("_")


def ns(name, cat):
    return f"{snake(cat)}.{snake(name)}"


def install_nodes_http(spec_dir: str, api_base: str):
    specs = []
    for p in pathlib.Path(spec_dir).glob("*.json"):
        specs.append(json.loads(p.read_text()))
    import requests
    r = requests.post(f"{api_base}/api/nodes/install", json={"specs": specs}, timeout=120)
    r.raise_for_status()
    print("Installed", len(specs), "nodes")


def try_sqlite(repo_path: str):
    cand = [os.path.join(repo_path, "assets", "db.sqlite"), os.path.join(repo_path, "data", "db.sqlite")]
    for c in cand:
        if os.path.exists(c):
            return c
    return None


def import_from_sqlite(db_path: str):
    cx = sqlite3.connect(db_path)
    cx.row_factory = sqlite3.Row
    cur = cx.cursor()
    cur.execute("select * from nodes limit 1")
    _ = cur.fetchone()
    cur.execute("select name, category, summary, auth_type, provider, operation_id from nodes")
    for row in cur.fetchall():
        name = ns(row["name"], row["category"])
        spec = {
          "name": name,
          "version": "1.0.0",
          "title": row["summary"] or row["name"],
          "category": row["category"] or "General",
          "auth": {"type": row["auth_type"] or "none", "provider": row["provider"]},
          "inputs": {}, "outputs": {"response":{"type":"object"}},
          "rate_limit": {"unit":"minute","limit":60},
          "retries": {"max":5,"backoff":"exponential","max_delay_sec":30},
          "impl": {"type":"http","openapi_provider": row["provider"], "operation_id": row["operation_id"], "base_url": None}
        }
        (OUT_NODES / f"{name}.json").write_text(json.dumps(spec, indent=2, ensure_ascii=False))
    cx.close()


def import_from_json_catalog(repo_path: str):
    folders = [os.path.join(repo_path, "catalog"), os.path.join(repo_path, "nodes")]
    found = False
    for folder in folders:
        if not os.path.isdir(folder):
            continue
        for p in pathlib.Path(folder).glob("*.json"):
            d = json.loads(p.read_text())
            name = ns(d.get("name", "action"), d.get("category", "General"))
            spec = {
              "name": name,
              "version": "1.0.0",
              "title": d.get("title") or d.get("summary") or d.get("name"),
              "category": d.get("category", "General"),
              "auth": {"type": d.get("auth", "none"), "provider": d.get("provider")},
              "inputs": d.get("inputs", {}),
              "outputs": {"response": {"type": "object"}},
              "rate_limit": {"unit": "minute", "limit": 60},
              "retries": {"max": 5, "backoff": "exponential", "max_delay_sec": 30},
              "impl": {"type": "http", "openapi_provider": d.get("provider"), "operation_id": d.get("operationId") or d.get("opId"), "base_url": d.get("baseUrl")}
            }
            (OUT_NODES / f"{name}.json").write_text(json.dumps(spec, indent=2, ensure_ascii=False))
            found = True
    if not found:
        print("No JSON catalog found; please point to SQLite or adjust mapping.")


def import_templates(repo_path: str, api_base: str):
    tpl_dirs = [os.path.join(repo_path, "templates"), os.path.join(repo_path, "data", "templates")]
    import requests
    count = 0
    for d in tpl_dirs:
        if not os.path.isdir(d):
            continue
        for p in pathlib.Path(d).glob("*.json*"):
            raw = p.read_text()
            try:
                arr = [json.loads(line) for line in raw.splitlines() if line.strip().startswith("{")]
            except Exception:
                arr = [json.loads(raw)]
            for t in arr:
                graph = convert_n8n_to_gasable_graph(t)
                body = {
                    "slug": snake(t.get("name", "tpl")),
                    "name": t.get("name", "Template"),
                    "description": t.get("description", ""),
                    "category": t.get("category", "General"),
                    "graph": graph,
                    "source": "n8n-mcp",
                }
                r = requests.post(f"{api_base}/api/templates/install", json=body, timeout=60)
                r.raise_for_status()
                count += 1
    print("Imported templates:", count)


def convert_n8n_to_gasable_graph(n8n_json: dict) -> dict:
    nodes = []
    edges = []
    for i, n in enumerate(n8n_json.get("nodes", [])):
        nid = str(n.get("id", i))
        nodes.append({
            "id": nid,
            "type": "toolNode",
            "position": {"x": 80 + (i * 40) % 600, "y": 80 + (i * 20) % 300},
            "data": {
                "label": n.get("name", "Node"),
                "toolName": ns(n.get("name", "node"), n.get("type", "General")),
                "params": n.get("parameters", {}),
            },
        })
    for c in n8n_json.get("connections", []):
        edges.append({
            "id": f"e{len(edges) + 1}",
            "source": str(c["from"]),
            "target": str(c["to"]),
            "label": c.get("type") or "",
        })
    return {"nodes": nodes, "edges": edges}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo-path", required=True, help="Path to local n8n-mcp checkout")
    ap.add_argument("--api-base", required=True, help="Your Gasable Hub API base")
    args = ap.parse_args()

    db = try_sqlite(args.repo_path)
    if db:
        import_from_sqlite(db)
    else:
        import_from_json_catalog(args.repo_path)

    install_nodes_http(str(OUT_NODES), args.api_base)
    import_templates(args.repo_path, args.api_base)


