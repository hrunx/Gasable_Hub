from __future__ import annotations

import os
from openai import OpenAI

from ..db.postgres import connect as pg_connect


def _pg():
    """Centralised Postgres connection helper respecting all env sources."""
    return pg_connect()


def _mcp_tool() -> dict:
    return {
        "type": "mcp",
        "server_url": os.getenv("MCP_URL", ""),
        "credentials": {"type": "bearer", "token": os.getenv("MCP_AUTH_TOKEN", "")},
        "transport": "http",
    }


def ensure_assistants() -> int:
    """Create OpenAI assistants for all rows in public.gasable_agents missing assistant_id.

    Stores the created assistant_id back to the table.
    """
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    created = 0
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select id, display_name, system_prompt, answer_model
                from public.gasable_agents
                where assistant_id is null or assistant_id = ''
                """
            )
            rows = cur.fetchall()
            for (aid, display, prompt, model) in rows:
                assistant = client.beta.assistants.create(
                    model=(model or "gpt-5"),
                    name=display or f"Gasable {aid}",
                    instructions=prompt,
                    tools=[_mcp_tool()],
                    metadata={"agent_id": aid},
                )
                cur.execute(
                    "update public.gasable_agents set assistant_id=%s, updated_at=now() where id=%s",
                    (assistant.id, aid),
                )
                created += 1
            conn.commit()
    return created
