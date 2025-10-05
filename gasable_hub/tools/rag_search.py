from __future__ import annotations

from typing import Optional
try:
    from mcp.server.fastmcp import Context  # type: ignore
except Exception:  # pragma: no cover
    class Context:  # type: ignore
        pass
from ..orch.search import hybrid_query
from ..orch.answer import synthesize_answer


async def rag_search(query: str, k: int = 12, agent_id: str = "default", namespace: str = "global", ctx: Context | None = None) -> dict:
	"""Hybrid search (vector + BM25) with LLM rerank and optional synthesis.

	Returns top-k hits and a grounded answer.
	"""
	if not query:
		return {"status": "error", "error": "query is required"}
	res = hybrid_query(query, agent_id=agent_id, namespace=namespace, k=k)
	answer = synthesize_answer(query, res["hits"]) if res.get("hits") else ""
	return {"status": "ok", "hits": res["hits"], "answer": answer}


def register(mcp):
	@mcp.tool()
	async def rag_search_tool(query: str, k: int = 12, agent_id: str = "default", namespace: str = "global", ctx: Context | None = None) -> dict:
		return await rag_search(query, k=k, agent_id=agent_id, namespace=namespace, ctx=ctx)


