import json
import os
from typing import List, Optional
from sqlalchemy import create_engine, text, bindparam
from sqlalchemy.dialects.postgresql import JSONB
from .schema import NodeSpec


_engine = None


def engine():
    global _engine
    if _engine is None:
        dsn = os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL") or os.getenv("NETLIFY_DATABASE_URL")
        _engine = create_engine(dsn, pool_pre_ping=True)
    return _engine


def install_nodes(specs: List[dict]):
    with engine().begin() as c:
        for d in specs:
            spec = NodeSpec(**d)
            stmt = text(
                """
              insert into public.nodes (name, version, title, category, spec, enabled)
              values (:name, :version, :title, :category, :spec, true)
              on conflict (name, version) do update
              set title=excluded.title, category=excluded.category, spec=excluded.spec, updated_at=now()
            """
            ).bindparams(bindparam("spec", type_=JSONB))
            c.execute(
                stmt,
                {
                    "name": spec.name,
                    "version": spec.version,
                    "title": spec.title,
                    "category": spec.category,
                    "spec": spec.dict(),
                },
            )


def _infer_required_keys(spec: dict) -> List[str]:
    # Heuristic: use auth provider name and common envs
    out: List[str] = []
    try:
        auth = spec.get("auth") or {}
        provider = (auth.get("provider") or auth.get("type") or "").lower()
        if provider:
            if "gmail" in provider or "google" in provider:
                out += ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"]
            if "notion" in provider:
                out += ["NOTION_API_KEY"]
            if "openai" in provider:
                out += ["OPENAI_API_KEY"]
    except Exception:
        pass
    return sorted(list({*out}))


def list_nodes(category: Optional[str] = None) -> List[dict]:
    q = "select name, version, title, category, enabled, spec from public.nodes"
    if category:
        q += " where category=:cat"
    with engine().begin() as c:
        rows = c.execute(text(q), {"cat": category} if category else {}).mappings().all()
    out: List[dict] = []
    for r in rows:
        d = dict(r)
        spec = d.pop("spec", None) or {}
        # Expose a concise description; fallback to inputs and auth
        doc = None
        try:
            doc = spec.get("doc")  # type: ignore[attr-defined]
        except Exception:
            doc = None
        if not doc:
            # Try to compose doc from inputs metadata
            try:
                inputs = spec.get("inputs") or {}
                if isinstance(inputs, dict) and inputs:
                    keys = list(inputs.keys())[:4]
                    doc = "Inputs: " + ", ".join(keys)
            except Exception:
                pass
        if doc:
            d["doc"] = str(doc)
        req_keys = _infer_required_keys(spec)
        if req_keys:
            d["required_keys"] = req_keys
        out.append(d)
    return out


def get_node(name: str, version: Optional[str] = None) -> Optional[dict]:
    q = "select spec from public.nodes where name=:name"
    if version:
        q += " and version=:ver"
    q += " order by version desc limit 1"
    with engine().begin() as c:
        r = c.execute(text(q), {"name": name, "ver": version}).scalar()
    return r


