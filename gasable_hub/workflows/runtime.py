from __future__ import annotations

import asyncio
import re
from collections import defaultdict, deque
from typing import Any, Dict, Iterable

from ..tools import invoke_tool_via_dummy
from ..db.postgres import connect

# Optional node runtime imports; guarded to keep this module importable in all envs
try:  # pragma: no cover - defensive import
    from gasable_nodes.registry import get_node as get_registered_node
    from gasable_nodes.schema import NodeSpec as _NodeSpec
    from gasable_nodes.runtime import run_node as _run_node, Context as _NodeContext
except Exception:  # pragma: no cover - best-effort fallback when nodes package unavailable
    get_registered_node = None  # type: ignore[assignment]
    _NodeSpec = None  # type: ignore[assignment]
    _run_node = None  # type: ignore[assignment]
    _NodeContext = None  # type: ignore[assignment]

_PLACEHOLDER_RE = re.compile(r"\$\{([^}]+)\}")


class WorkflowExecutionError(Exception):
    """Raised when workflow execution fails due to configuration issues."""


def _topological_order(nodes: Dict[str, dict], edges: Iterable[dict]) -> list[str]:
    indegree: Dict[str, int] = {node_id: 0 for node_id in nodes}
    outgoing: Dict[str, list[str]] = defaultdict(list)
    for edge in edges:
        src = edge.get("source")
        dst = edge.get("target")
        if src is None or dst is None:
            continue
        if src not in nodes or dst not in nodes:
            raise WorkflowExecutionError(f"Invalid edge references {src!r} -> {dst!r}")
        outgoing[src].append(dst)
        indegree[dst] = indegree.get(dst, 0) + 1
    queue: deque[str] = deque([nid for nid, deg in indegree.items() if deg == 0])
    order: list[str] = []
    while queue:
        current = queue.popleft()
        order.append(current)
        for nxt in outgoing.get(current, []):
            indegree[nxt] -= 1
            if indegree[nxt] == 0:
                queue.append(nxt)
    if len(order) != len(nodes):
        raise WorkflowExecutionError("Workflow contains a cycle or unreachable node")
    return order


def _resolve_path(path: str, context: dict) -> Any:
    current: Any = context
    for part in path.split('.'):
        if isinstance(current, dict):
            current = current.get(part)
        elif isinstance(current, (list, tuple)) and part.isdigit():
            current = current[int(part)]
        else:
            raise WorkflowExecutionError(f"Unable to resolve placeholder '{path}'")
    return current


def _render_template(value: Any, context: dict) -> Any:
    if isinstance(value, str):
        matches = list(_PLACEHOLDER_RE.finditer(value))
        if not matches:
            return value
        if len(matches) == 1 and matches[0].span() == (0, len(value)):
            return _resolve_path(matches[0].group(1), context)
        return _PLACEHOLDER_RE.sub(lambda m: str(_resolve_path(m.group(1), context)), value)
    if isinstance(value, dict):
        return {k: _render_template(v, context) for k, v in value.items()}
    if isinstance(value, list):
        return [_render_template(v, context) for v in value]
    return value


def _coerce_tool_inputs(node: dict, state: dict, ctx: dict | None) -> dict:
    raw_inputs = node.get("inputs", {})
    rendered = _render_template(raw_inputs, state)
    if ctx is not None and "ctx" not in rendered:
        rendered["ctx"] = ctx
    return rendered


def _register_node_output(state: dict, node_id: str, data: Any) -> None:
    state[node_id] = data


async def _execute_tool_node(node: dict, state: dict, ctx: dict | None) -> Any:
    tool_name = node.get("tool")
    if not tool_name:
        raise WorkflowExecutionError(f"Tool node '{node.get('id')}' is missing 'tool'")

    tool_inputs = _coerce_tool_inputs(node, state, ctx)

    # First, attempt to execute via the Gasable node registry if available
    if get_registered_node and _NodeSpec and _run_node and _NodeContext:
        try:
            spec_json = get_registered_node(tool_name)
        except Exception:
            spec_json = None
        if isinstance(spec_json, dict):
            # Build credential resolver that reads from DB secrets and env
            async def _cred_resolver(provider: str | None, credential_id: str | None):  # type: ignore[name-defined]
                # Load all portal secrets once per resolve
                secrets_map: dict[str, str] = {}
                try:
                    with connect() as _conn:
                        with _conn.cursor() as _cur:
                            _cur.execute("select name, value from public.portal_secrets")
                            for n, v in _cur.fetchall():
                                if isinstance(n, str) and isinstance(v, str):
                                    secrets_map[n] = v
                except Exception:
                    pass

                # Provider-specific mapping to expected fields
                prov = (provider or "").lower()
                # Prefer explicit access_token if present, otherwise api_key
                if prov in ("openai",):
                    val = secrets_map.get("OPENAI_API_KEY") or secrets_map.get("OPENAI_TOKEN") or os.getenv("OPENAI_API_KEY")
                    return {"api_key": val} if val else {}
                if prov in ("notion",):
                    val = secrets_map.get("NOTION_API_KEY") or os.getenv("NOTION_API_KEY")
                    return {"api_key": val} if val else {}
                if "google" in prov or prov in ("gmail", "google_sheets", "sheets"):
                    # Expect an access token (short-lived) or a generic API key fallback
                    at = secrets_map.get("GOOGLE_ACCESS_TOKEN") or os.getenv("GOOGLE_ACCESS_TOKEN")
                    if at:
                        return {"access_token": at}
                    ak = secrets_map.get("GOOGLE_API_KEY") or os.getenv("GOOGLE_API_KEY")
                    return {"api_key": ak} if ak else {}
                # Generic fallbacks
                gen_at = secrets_map.get("ACCESS_TOKEN") or os.getenv("ACCESS_TOKEN")
                if gen_at:
                    return {"access_token": gen_at}
                gen_key = secrets_map.get("API_KEY") or os.getenv("API_KEY")
                return {"api_key": gen_key} if gen_key else {}

            # Execute via node runtime
            import os  # local import to avoid polluting module scope
            import httpx

            spec = _NodeSpec(**spec_json)
            async with httpx.AsyncClient(timeout=60) as http:
                node_ctx = _NodeContext(http=http, logger=print, cred_resolver=_cred_resolver)
                result = await _run_node(spec, tool_inputs, state, node_ctx)
                return result

        # If not found in registry, execute via a generic catalog proxy spec so every node runs
        # This ensures imported templates are immediately runnable even without specific implementations
        import httpx
        # Heuristic: normalize tool name to leaf.leaf
        leaf = (tool_name or "node").split(".")[-1].lower()
        for suf in ("trigger", "workflow"):
            if leaf.endswith(suf):
                leaf = leaf[: -len(suf)]
                break
        import re as _re
        leaf = _re.sub(r"[^a-z0-9_]+", "_", leaf) or "node"
        synthetic_spec = {
            "name": f"{leaf}.{leaf}",
            "version": "1.0.0",
            "title": tool_name,
            "category": "Catalog",
            "doc": None,
            "auth": {"type": "none", "provider": None, "scopes": []},
            "inputs": {},
            "outputs": {"response": {"type": "object"}},
            "rate_limit": {"unit": "minute", "limit": 60},
            "retries": {"max": 3, "backoff": "exponential", "max_delay_sec": 30},
            "impl": {"type": "python", "module": "gasable_nodes.plugins.catalog.proxy", "function": "run"},
        }
        spec = _NodeSpec(**synthetic_spec)
        async with httpx.AsyncClient(timeout=60) as http:
            # Cred resolver is not used for proxy (auth none), provide a no-op
            async def _noop_resolver(provider, credential_id):
                return {}
            node_ctx = _NodeContext(http=http, logger=print, cred_resolver=_noop_resolver)
            result = await _run_node(spec, tool_inputs, state, node_ctx)
            return result

    # Fallback to MCP tool invocation (legacy tools path)
    fn, kwargs = invoke_tool_via_dummy(tool_name, **tool_inputs)
    result = fn(**kwargs)
    if asyncio.iscoroutine(result):
        result = await result
    return result


def _execute_mapper_node(node: dict, state: dict) -> Any:
    mapping = node.get("mapping") or {}
    return _render_template(mapping, state)


def _execute_output_node(node: dict, state: dict) -> Any:
    source = node.get("source")
    if source:
        data = state.get(source)
        if data is None:
            raise WorkflowExecutionError(f"Output node references missing source '{source}'")
        fields = node.get("fields")
        if fields and isinstance(data, dict):
            return {key: data.get(key) for key in fields}
        return data
    value = node.get("value")
    return _render_template(value, state) if value is not None else None


async def execute_workflow(graph: dict, inputs: dict | None = None, *, ctx: dict | None = None) -> dict:
    """Execute a workflow graph and return the final output payload.

    The graph is expected to include `nodes` (list of {id,type,...}) and optional `edges`.
    Node types supported:
      - input: seeds workflow state from `inputs` or optional defaults
      - tool: invokes an MCP tool by name with templated arguments
      - mapper: transforms state via templated mapping
      - output: marks the final payload (optional)
    """

    nodes_cfg = graph.get("nodes") or []
    nodes = {node.get("id"): node for node in nodes_cfg if node.get("id")}
    if not nodes:
        raise WorkflowExecutionError("Workflow graph is empty")

    order = _topological_order(nodes, graph.get("edges") or [])
    state: dict[str, Any] = {"input": inputs or {}}
    if ctx:
        state["context"] = ctx

    for node_id in order:
        node = nodes[node_id]
        node_type = (node.get("type") or "tool").lower()
        
        # Normalize UI node types to execution types
        # Skip pure UI nodes (start, decision, agent)
        if node_type in ("startnode", "start"):
            # Start nodes are just UI markers, skip execution
            _register_node_output(state, node_id, {"status": "started"})
            continue
        if node_type in ("toolnode",):
            # toolNode from UI -> treat as tool execution
            node_type = "tool"
        if node_type in ("agentnode",):
            # agentNode -> treat as tool execution (agent is just a special tool)
            node_type = "tool"
        if node_type in ("decisionnode",):
            # decisionNode -> treat as mapper
            node_type = "mapper"
        
        # Execute based on normalized type
        if node_type == "input":
            payload = node.get("defaults") or {}
            merged = {**payload, **(inputs or {})}
            _register_node_output(state, node_id, merged)
            continue
        if node_type == "tool":
            # Get tool name from node data or direct property
            if not node.get("tool"):
                # Try to extract from data.toolName
                data = node.get("data", {})
                tool_name = data.get("toolName") if isinstance(data, dict) else None
                if tool_name:
                    node = {**node, "tool": tool_name}
            
            result = await _execute_tool_node(node, state, ctx)
            _register_node_output(state, node_id, result)
            continue
        if node_type == "mapper":
            result = _execute_mapper_node(node, state)
            _register_node_output(state, node_id, result)
            continue
        if node_type == "output":
            result = _execute_output_node(node, state)
            _register_node_output(state, node_id, result)
            continue
        raise WorkflowExecutionError(f"Unsupported node type '{node_type}'")

    # Prefer explicit output nodes; fall back to last evaluated node
    for node_id in reversed(order):
        node = nodes[node_id]
        if (node.get("type") or "").lower() == "output":
            return state.get(node_id, {}) or {}
    last_id = order[-1]
    return state.get(last_id, {}) or {}
