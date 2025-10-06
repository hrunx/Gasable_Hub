from __future__ import annotations

import asyncio
import re
from collections import defaultdict, deque
from typing import Any, Dict, Iterable

from ..tools import invoke_tool_via_dummy

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
        if node_type == "input":
            payload = node.get("defaults") or {}
            merged = {**payload, **(inputs or {})}
            _register_node_output(state, node_id, merged)
            continue
        if node_type == "tool":
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
