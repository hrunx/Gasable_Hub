from openai import OpenAI
import os


async def run(params, inputs, creds, ctx):
    api_key = (creds or {}).get("api_key") or os.getenv("OPENAI_API_KEY")
    client = OpenAI(api_key=api_key)
    out = client.embeddings.create(
        model=params.get("model", "text-embedding-3-large"),
        input=params["input"],
        dimensions=1536,
    )
    return {"response": out.model_dump()}


