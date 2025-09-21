from typing import Optional
from mcp.server.fastmcp import Context
import os
import httpx


async def rag_search(query: str, k: int = 5, ctx: Context = None) -> dict:
	"""Perform retrieval-augmented generation search. Minimal API LLM baseline.

	This baseline only calls the OpenAI ChatCompletion API if OPENAI_API_KEY is set.
	No local models are used, per preference.
	"""
	if not query:
		return {"status": "error", "error": "query is required"}

	openai_api_key = os.getenv("OPENAI_API_KEY")
	model = os.getenv("OPENAI_MODEL", "gpt-3.5-turbo")
	answer: Optional[str] = None

	if openai_api_key:
		try:
			headers = {
				"Authorization": f"Bearer {openai_api_key}",
				"Content-Type": "application/json",
			}
			payload = {
				"model": model,
				"messages": [
					{"role": "system", "content": "You are a helpful assistant."},
					{"role": "user", "content": query},
				],
			}

			async with httpx.AsyncClient(timeout=60) as client:
				resp = await client.post("https://api.openai.com/v1/chat/completions", headers=headers, json=payload)
				resp.raise_for_status()
				data = resp.json()
				answer = data["choices"][0]["message"]["content"].strip()
		except Exception as e:
			return {"status": "error", "error": f"LLM call failed: {e}"}

	# In a full RAG system, we would fetch relevant chunks (k) then ask the LLM.
	return {
		"status": "success",
		"query": query,
		"k": k,
		"answer": answer,
		"provider": "openai" if openai_api_key else None,
	}


def register(mcp):
	@mcp.tool()
	async def rag_search_tool(query: str, k: int = 5, ctx: Context | None = None) -> dict:
		return await rag_search(query, k, ctx)


