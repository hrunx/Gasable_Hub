from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import httpx
from typing import Optional
from gasable_nodes.registry import list_nodes, install_nodes, get_node
from gasable_nodes.schema import NodeSpec
from gasable_nodes.runtime import run_node, Context


router = APIRouter(prefix="/api/nodes")


class InstallIn(BaseModel):
    specs: list[dict]


@router.get("")
def api_list_nodes(category: Optional[str] = None):
    return list_nodes(category)


@router.post("/install")
def api_install_nodes(body: InstallIn):
    install_nodes(body.specs)
    return {"ok": True, "count": len(body.specs)}


class RunIn(BaseModel):
    name: str
    version: Optional[str] = None
    params: dict = {}
    inputs: dict = {}
    credential_id: Optional[str] = None


async def default_cred_resolver(provider: Optional[str], credential_id: Optional[str]):
    return {}


@router.post("/run")
async def api_run_node(body: RunIn):
    spec_json = get_node(body.name, body.version)
    if not spec_json:
        raise HTTPException(404, f"node {body.name} not found")
    spec = NodeSpec(**spec_json)

    async with httpx.AsyncClient() as http:
        ctx = Context(http=http, logger=print, cred_resolver=default_cred_resolver)
        out = await run_node(spec, {**body.params, "credential_id": body.credential_id}, body.inputs, ctx)
        return {"outputs": out}


