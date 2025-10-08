from typing import Dict, Any, Optional
from .schema import NodeSpec, ImplOpenAPI


def build_request(openapi_provider: str, operation_id: str, params: Dict[str, Any], base_url_override: Optional[str]):
    from .openapi_registry import get_operation

    op, server_url = get_operation(openapi_provider, operation_id)
    method = op["method"].lower()
    path = op["path"]
    base_url = base_url_override or server_url

    path_params = {p["name"]: params[p["name"]] for p in op.get("parameters", []) if p.get("in") == "path" and p["name"] in params}
    q_params = {p["name"]: params[p["name"]] for p in op.get("parameters", []) if p.get("in") == "query" and p["name"] in params}
    header_params = {p["name"]: params[p["name"]] for p in op.get("parameters", []) if p.get("in") == "header" and p["name"] in params}

    url = base_url + path.format(**path_params)
    body = None
    if "requestBody" in op:
        body = params.get("body") or {k: params[k] for k in params.keys() if k not in {**path_params, **q_params, **header_params}}

    return method, url, q_params, header_params, body


async def exec_openapi(spec: NodeSpec, params: Dict[str, Any], inputs: Dict[str, Any], creds: Optional[Dict[str, Any]], ctx):
    impl: ImplOpenAPI = spec.impl  # type: ignore
    method, url, q_params, header_params, body = build_request(
        impl.openapi_provider, impl.operation_id, params, impl.base_url
    )

    headers = header_params or {}
    if spec.auth.type == "token" and creds:
        token = creds.get("access_token") or creds.get("api_key")
        if token:
            headers["Authorization"] = f"Bearer {token}"
    if spec.auth.type == "oauth2" and creds:
        headers["Authorization"] = f"Bearer {creds['access_token']}"

    import httpx

    async with ctx.http as http:
        r = await http.request(method.upper(), url, params=q_params, headers=headers, json=body, timeout=60)
        r.raise_for_status()
        data = r.json() if "application/json" in r.headers.get("content-type", "") else {"raw": r.text}
        return {"response": data}


