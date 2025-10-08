async def run(params, inputs, creds, ctx):
    mapping = params.get("mapping") or {}
    out = {}
    for k, v in mapping.items():
        out[k] = inputs.get(v) if isinstance(v, str) else v
    return {"response": out}


