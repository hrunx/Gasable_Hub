import json, os, pathlib

OUT = pathlib.Path("generated_nodes/openai"); OUT.mkdir(parents=True, exist_ok=True)


def write(name, title, inputs, outputs, impl):
    spec = {
      "name": f"openai.{name}",
      "version": "1.0.0",
      "title": title,
      "category": "OpenAI",
      "auth": {"type":"token","provider":"openai"},
      "inputs": inputs,
      "outputs": outputs,
      "rate_limit": {"unit":"minute","limit":500},
      "retries": {"max":5,"backoff":"exponential","max_delay_sec":30},
      "impl": impl
    }
    (OUT / f"openai.{name}.json").write_text(json.dumps(spec, indent=2))


write(
  "chat",
  "Chat Completion",
  {
    "model": {"type":"string","required":True, "default":"gpt-5-mini"},
    "messages": {"type":"array","required":True, "description":"[{role, content}]"},
    "temperature": {"type":"number","required":False, "default":0}
  },
  {"response":{"type":"object"}},
  {"type":"python","module":"gasable_nodes.plugins.openai.chat","function":"run"}
)

write(
  "embeddings",
  "Create Embeddings",
  {
    "model":{"type":"string","required":True,"default":"text-embedding-3-large"},
    "input":{"type":"array","required":True}
  },
  {"response":{"type":"object"}},
  {"type":"python","module":"gasable_nodes.plugins.openai.embeddings","function":"run"}
)

write(
  "images_generate",
  "Generate Image",
  {
    "model":{"type":"string","required":False,"default":"gpt-image-1"},
    "prompt":{"type":"string","required":True}
  },
  {"response":{"type":"object"}},
  {"type":"python","module":"gasable_nodes.plugins.openai.images","function":"run"}
)

print("Generated OpenAI node specs.")


