import asyncio
import os
from typing import Any, Dict, List
import httpx


async def fetch_templates(api_base: str) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    limit = 200
    offset = 0
    async with httpx.AsyncClient(timeout=60) as http:
        while True:
            r = await http.get(f"{api_base}/api/templates", params={"limit": limit, "offset": offset})
            r.raise_for_status()
            page = r.json()
            if not page:
                break
            items.extend(page)
            if len(page) < limit:
                break
            offset += limit
    return items


async def get_template(api_base: str, slug: str) -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=60) as http:
        r = await http.get(f"{api_base}/api/templates/{slug}")
        r.raise_for_status()
        return r.json()


async def upsert_workflow(api_base: str, wid: str, name: str, graph: Dict[str, Any]) -> None:
    payload = {"id": wid, "display_name": name, "namespace": "global", "graph": graph}
    async with httpx.AsyncClient(timeout=60) as http:
        r = await http.post(f"{api_base}/api/workflows", json=payload)
        r.raise_for_status()


async def main() -> None:
    api_base = os.environ.get("GASABLE_API_BASE", "http://127.0.0.1:8000").rstrip("/")
    templates = await fetch_templates(api_base)
    print("templates:", len(templates))
    total = 0
    for t in templates:
        slug = t.get("slug")
        if not slug:
            continue
        try:
            full = await get_template(api_base, slug)
            graph = full.get("graph") or {"nodes": [], "edges": []}
            wid = f"tpl-{slug}"
            await upsert_workflow(api_base, wid, full.get("name") or slug, graph)
            total += 1
            if total % 50 == 0:
                print("workflows installed:", total)
        except Exception as e:
            print(f"skip slug={slug} error={e}")
    print("workflows installed:", total)


if __name__ == "__main__":
    asyncio.run(main())


