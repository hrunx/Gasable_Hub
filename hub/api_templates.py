from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import create_engine, text
import os, json
from typing import Optional


router = APIRouter(prefix="/api/templates")


def _get_engine():
    dsn = os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL") or os.getenv("NETLIFY_DATABASE_URL")
    if not dsn:
        # Delay engine creation until DSN is available
        raise RuntimeError("DATABASE_URL not configured in environment")
    return create_engine(dsn, pool_pre_ping=True)


class TemplateIn(BaseModel):
    slug: str
    name: str
    description: Optional[str] = None
    category: str = "General"
    graph: dict
    source: str = "import"


@router.post("/install")
def install_tpl(body: TemplateIn):
    with _get_engine().begin() as c:
        c.execute(
            text(
                """
          insert into public.templates (slug, name, description, category, graph, source)
          values (:slug, :name, :description, :category, CAST(:graph AS JSONB), :source)
          on conflict (slug) do update
          set name=excluded.name, description=excluded.description, category=excluded.category, graph=excluded.graph, source=excluded.source
        """
            ),
            body.model_dump() | {"graph": json.dumps(body.graph)},
        )
    return {"ok": True}


@router.get("")
def list_tpl(category: Optional[str] = None, q: Optional[str] = None, limit: int = 100, offset: int = 0):
    # Safety: cap limit and offset to prevent runaway pagination
    limit = min(limit, 1000)
    offset = min(offset, 100000)
    
    where = []
    params = {}
    if category:
        where.append("category=:category"); params["category"]=category
    if q:
        where.append("(name ilike :q or description ilike :q)"); params["q"] = f"%{q}%"
    sql = "select id, slug, name, category, description from public.templates"
    if where: sql += " where " + " and ".join(where)
    sql += " order by created_at desc limit :limit offset :offset"
    params["limit"]=limit; params["offset"]=offset
    with _get_engine().begin() as c:
        rows = c.execute(text(sql), params).mappings().all()
    return [dict(r) for r in rows]


@router.get("/{slug}")
def get_tpl(slug: str):
    with _get_engine().begin() as c:
        row = c.execute(
            text("select id, slug, name, category, description, graph from public.templates where slug=:slug"),
            {"slug": slug},
        ).mappings().first()
    if not row:
        return {"error": "not_found"}
    d = dict(row)
    if isinstance(d.get("graph"), str):
        try:
            d["graph"] = json.loads(d["graph"])  # type: ignore
        except Exception:
            pass
    return d


