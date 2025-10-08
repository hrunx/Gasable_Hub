from __future__ import annotations

import os, requests
try:
    from mcp.server.fastmcp import Context  # type: ignore
except Exception:
    class Context:  # type: ignore
        pass

def register(mcp):
    @mcp.tool()
    def webhook_post(payload: dict, ctx: Context | None = None) -> dict:
        url = os.getenv('WEBHOOK_URL','').strip()
        if not url: return {'status':'error','error':'WEBHOOK_URL not set'}
        headers={'Content-Type':'application/json'}
        extra=os.getenv('WEBHOOK_AUTH','').strip()
        if extra: headers['Authorization']=extra
        try:
            r = requests.post(url, json=payload, headers=headers, timeout=60)
            r.raise_for_status()
            return {'status':'ok','result': r.json() if 'application/json' in r.headers.get('content-type','') else r.text}
        except Exception as e:
            return {'status':'error','error': str(e)}