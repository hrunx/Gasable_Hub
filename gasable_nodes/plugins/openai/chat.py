from openai import OpenAI
import os


async def run(params, inputs, creds, ctx):
    api_key = (creds or {}).get("api_key") or os.getenv("OPENAI_API_KEY")
    client = OpenAI(api_key=api_key)
    resp = client.chat.completions.create(
        model=params.get("model", "gpt-5-mini"),
        messages=params["messages"],
        temperature=params.get("temperature", 0),
    )
    return {"response": resp.model_dump()}


