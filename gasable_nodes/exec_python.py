import importlib
from typing import Dict, Any, Optional
from .schema import NodeSpec, ImplPython


async def exec_python(spec: NodeSpec, params: Dict[str, Any], inputs: Dict[str, Any], creds: Optional[Dict[str, Any]], ctx):
    impl: ImplPython = spec.impl  # type: ignore
    mod = importlib.import_module(impl.module)
    fn = getattr(mod, impl.function, None)
    if not fn:
        raise RuntimeError(f"Function {impl.function} not found in {impl.module}")
    return await fn(params, inputs, creds, ctx)


