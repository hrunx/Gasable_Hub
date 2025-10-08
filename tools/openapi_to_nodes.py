import json, os, re, argparse, pathlib


def snake(s):
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def provider_name(title):
    return snake(title)


def load_openapi(path_or_url: str) -> dict:
    import requests, yaml
    if path_or_url.startswith("http"):
        r = requests.get(path_or_url, timeout=60)
        r.raise_for_status()
        data = r.text
    else:
        data = open(path_or_url, "r", encoding="utf-8").read()
    try:
        return json.loads(data)
    except Exception:
        return yaml.safe_load(data)


def extract_inputs(op: dict):
    inputs = {}
    for p in op.get("parameters", []):
        nm = p["name"]
        req = bool(p.get("required"))
        typ = p.get("schema", {}).get("type", "string")
        typ = typ if typ in ["string", "number", "boolean", "object", "array"] else "string"
        inputs[nm] = {"type": typ, "required": req, "description": p.get("description", "")}
    if "requestBody" in op:
        inputs["body"] = {"type": "object", "required": False, "description": "JSON body"}
    return inputs


def gen_nodes(openapi: dict, category: str, out_dir: str):
    title = openapi.get("info", {}).get("title", category)
    provider = provider_name(title) or snake(category)
    server_url = (openapi.get("servers") or [{"url": ""}])[0]["url"]

    paths = openapi.get("paths", {})
    count = 0
    os.makedirs(out_dir, exist_ok=True)
    for path, methods in paths.items():
        for method, op in methods.items():
            op_id = op.get("operationId") or f"{method}_{path}"
            name = f"{provider}.{snake(op_id)}"
            spec = {
                "name": name,
                "version": "1.0.0",
                "title": op.get("summary") or op_id,
                "category": category,
                "doc": op.get("description", ""),
                "auth": {"type": "oauth2", "provider": provider, "scopes": op.get("x-scopes", [])},
                "inputs": extract_inputs(op),
                "outputs": {"response": {"type": "object"}},
                "rate_limit": {"unit": "minute", "limit": 60},
                "retries": {"max": 5, "backoff": "exponential", "max_delay_sec": 30},
                "impl": {"type": "http", "openapi_provider": provider, "operation_id": op_id, "base_url": server_url},
            }
            path_out = os.path.join(out_dir, f"{name}.json")
            with open(path_out, "w", encoding="utf-8") as f:
                json.dump(spec, f, indent=2, ensure_ascii=False)
            count += 1
    return count


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True, help="OpenAPI URL or file path")
    ap.add_argument("--category", required=True, help="Catalog grouping, e.g., 'Slack'")
    ap.add_argument("--out", default="generated_nodes")
    args = ap.parse_args()
    oas = load_openapi(args.spec)
    n = gen_nodes(oas, args.category, args.out)
    print(f"Generated {n} nodes into {args.out}")


