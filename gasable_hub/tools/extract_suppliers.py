from __future__ import annotations

import os
import json
from typing import Any, Dict

try:
    from mcp.server.fastmcp import Context  # type: ignore
except Exception:  # pragma: no cover
    class Context:  # type: ignore
        pass

from openai import OpenAI


def register(mcp):
    @mcp.tool()
    async def extract_suppliers(
        text: str,
        max_items: int = 10,
        region_hint: str | None = None,
        industry_hint: str | None = None,
        ctx: Context | None = None,
    ) -> Dict[str, Any]:
        """Extract a list of suppliers from free-form text.

        Returns: { suppliers: [{name, website?, email?}], source_summary: str }
        """
        api_key = os.getenv("OPENAI_API_KEY", "").strip()
        if not api_key:
            return {"status": "error", "error": "OPENAI_API_KEY not set"}
        client = OpenAI(api_key=api_key)
        sys = (
            "You extract structured entities. Return STRICT JSON with key 'suppliers' as an array of objects "
            "each with fields: name (string), website (string or ''), email (string or ''). "
            "Do not add commentary."
        )
        prompt = (
            (f"Region: {region_hint}\n" if region_hint else "")
            + (f"Industry: {industry_hint}\n" if industry_hint else "")
            + f"Max items: {max_items}\n"
            + "Text:\n" + text[:8000]
        )
        try:
            r = client.chat.completions.create(
                model=os.getenv("OPENAI_MODEL", "gpt-5-mini"),
                temperature=0,
                messages=[
                    {"role": "system", "content": sys},
                    {"role": "user", "content": prompt},
                ],
            )
            content = r.choices[0].message.content or "{}"
            try:
                start = content.find("{")
                end = content.rfind("}")
                obj = content[start : end + 1] if start != -1 and end != -1 else "{}"
                data = json.loads(obj)
            except Exception:
                data = {}
            sups = data.get("suppliers") if isinstance(data.get("suppliers"), list) else []
            # Normalize objects
            out = []
            for s in sups[:max_items]:
                if not isinstance(s, dict):
                    continue
                out.append({
                    "name": str(s.get("name") or "").strip(),
                    "website": str(s.get("website") or "").strip(),
                    "email": str(s.get("email") or "").strip(),
                })
            return {"status": "ok", "suppliers": [s for s in out if s.get("name")], "source_summary": text[:500]}
        except Exception as e:  # pragma: no cover
            return {"status": "error", "error": str(e)}


