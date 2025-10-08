from __future__ import annotations

import os
import json
from typing import List, Dict, Any, Optional

try:
    from mcp.server.fastmcp import Context  # type: ignore
except Exception:  # pragma: no cover
    class Context:  # type: ignore
        pass

from openai import OpenAI


def _as_bullets(leads: Optional[List[Dict[str, Any]]]) -> str:
    if not leads:
        return "(no structured leads provided; write a general outreach)"
    lines: List[str] = []
    for lead in leads[:50]:
        if not isinstance(lead, dict):
            continue
        name = str(lead.get("name") or lead.get("company") or lead.get("title") or "Lead").strip()
        email = str(lead.get("email") or "").strip()
        extra = []
        city = lead.get("city") or lead.get("location")
        if city:
            extra.append(str(city))
        niche = lead.get("niche") or lead.get("industry")
        if niche:
            extra.append(str(niche))
        suffix = (" - " + ", ".join(extra)) if extra else ""
        lines.append(f"- {name}{suffix}{(' <'+email+'>') if email else ''}")
    return "\n".join(lines)


def register(mcp):
    @mcp.tool()
    async def compose_email(
        topic: str,
        leads: Optional[List[Dict[str, Any]]] = None,
        goal: str = "welcome",
        tone: str = "professional",
        language: str = "en",
        company_name: str | None = None,
        company_offer: str | None = None,
        ctx: Context | None = None,
    ) -> Dict[str, Any]:
        """Draft a compelling email based on a topic and optional leads.

        Returns: { subject: str, body: str, drafts?: [{to, subject, body}] }
        """
        api_key = os.getenv("OPENAI_API_KEY", "").strip()
        if not api_key:
            return {"status": "error", "error": "OPENAI_API_KEY not set"}
        client = OpenAI(api_key=api_key)

        audience = _as_bullets(leads)
        sys = (
            "You are a senior B2B marketer. Write concise, actionable emails. "
            "Always return STRICT JSON with keys: subject, body, and drafts (array of {to, subject, body}). "
            "Body should be plain text, no markdown. Keep to 120-200 words."
        )
        prompt = (
            f"Language: {language}\n"
            f"Tone: {tone}\n"
            f"Campaign goal: {goal}\n"
            f"Topic: {topic}\n"
            f"Company: {company_name or ''}\n"
            f"Offer: {company_offer or ''}\n"
            f"Audience (first few leads):\n{audience}\n\n"
            "Return strictly JSON."
        )
        try:
            r = client.chat.completions.create(
                model=os.getenv("OPENAI_MODEL", "gpt-5-mini"),
                temperature=0.2,
                messages=[
                    {"role": "system", "content": sys},
                    {"role": "user", "content": prompt},
                ],
            )
            txt = r.choices[0].message.content or "{}"
            try:
                start = txt.find("{")
                end = txt.rfind("}")
                obj = txt[start : end + 1] if start != -1 and end != -1 else "{}"
                data = json.loads(obj)
            except Exception:
                data = {}
            subject = str(data.get("subject") or f"{(company_name or 'Our team')} — {goal.title()}").strip()
            body = str(data.get("body") or "").strip()
            drafts = data.get("drafts") if isinstance(data.get("drafts"), list) else []
            return {"status": "ok", "subject": subject, "body": body, "drafts": drafts}
        except Exception as e:  # pragma: no cover
            return {"status": "error", "error": str(e)}


