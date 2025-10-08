from openai import OpenAI
import os


async def run(params, inputs, creds, ctx):
    api_key = (creds or {}).get("api_key") or os.getenv("OPENAI_API_KEY")
    client = OpenAI(api_key=api_key)
    out = client.images.generate(
        model=params.get("model", "gpt-image-1"),
        prompt=params["prompt"],
    )
    return {"response": out.model_dump()}


