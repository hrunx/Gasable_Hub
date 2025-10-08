import json
import os
from functools import lru_cache
from typing import Tuple


@lru_cache(maxsize=128)
def _load_openapi(provider: str) -> dict:
    base = os.getenv("OPENAPI_CACHE_DIR", "openapi_specs")
    path_json = os.path.join(base, f"{provider}.json")
    path_yaml = os.path.join(base, f"{provider}.yaml")
    if os.path.exists(path_json):
        return json.loads(open(path_json, "r", encoding="utf-8").read())
    if os.path.exists(path_yaml):
        import yaml

        return yaml.safe_load(open(path_yaml, "r", encoding="utf-8"))
    raise RuntimeError(f"OpenAPI spec not found for provider: {provider}")


def get_operation(provider: str, operation_id: str) -> Tuple[dict, str]:
    oas = _load_openapi(provider)
    server_url = (oas.get("servers") or [{"url": ""}])[0]["url"]
    paths = oas.get("paths", {})
    for path, methods in paths.items():
        for method, op in methods.items():
            if op.get("operationId") == operation_id:
                return (
                    {
                        "method": method,
                        "path": path,
                        "parameters": op.get("parameters", []),
                        "requestBody": op.get("requestBody"),
                    },
                    server_url,
                )
    raise KeyError(f"operationId={operation_id} not found in provider={provider}")


