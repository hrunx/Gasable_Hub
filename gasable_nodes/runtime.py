import asyncio
from typing import Any, Dict
from .schema import NodeSpec, ImplOpenAPI, ImplPython
from .exec_http import exec_openapi
from .exec_python import exec_python


class ExecutionError(Exception):
    ...


class Context:
    def __init__(self, http, logger, cred_resolver):
        self.http = http
        self.log = logger
        self.cred_resolver = cred_resolver


async def run_node(spec: NodeSpec, params: Dict[str, Any], inputs: Dict[str, Any], ctx: Context) -> Dict[str, Any]:
    creds = None
    if spec.auth and spec.auth.type != "none":
        credential_id = params.get("credential_id") if isinstance(params, dict) else None
        creds = await ctx.cred_resolver(spec.auth.provider, credential_id)

    if isinstance(spec.impl, ImplOpenAPI):
        return await exec_openapi(spec, params, inputs, creds, ctx)
    elif isinstance(spec.impl, ImplPython):
        return await exec_python(spec, params, inputs, creds, ctx)

    raise ExecutionError(f"Unknown impl for {spec.name}")


