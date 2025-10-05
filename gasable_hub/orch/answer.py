from __future__ import annotations

import os
from openai import OpenAI


_oai = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def synthesize_answer(q: str, hits: list[dict], model: str = "gpt-5-mini") -> str:
	ctx = "\n\n".join(f"[{i+1}] {h.get('txt','')}" for i, h in enumerate(hits))
	msgs = [
		{"role": "system", "content": "Answer using ONLY the context. If missing, say you don’t know. Cite as [1],[2],…"},
		{"role": "user", "content": f"Question: {q}\n\nContext:\n{ctx}"},
	]
	out = _oai.chat.completions.create(model=model, messages=msgs, temperature=0)
	return out.choices[0].message.content or ""


