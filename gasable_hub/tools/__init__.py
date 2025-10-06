from __future__ import annotations

import importlib
import inspect
import pkgutil
from types import ModuleType
from typing import Callable


# Simple in-process registry to expose tool metadata to the web UI
REGISTERED_TOOL_SPECS: list[dict] = []
_TOOL_KEYS: set[str] = set()


def _extract_parameters(fn: Callable) -> list[dict]:
	params: list[dict] = []
	sig = inspect.signature(fn)
	for name, param in sig.parameters.items():
		if name in {"ctx", "context"}:
			continue
		info: dict[str, object] = {"name": name, "kind": param.kind.name.lower()}
		if param.annotation is not inspect._empty:
			annotation = param.annotation
			typename = getattr(annotation, "__name__", None)
			info["type"] = typename or str(annotation)
		if param.default is not inspect._empty:
			info["default"] = param.default
		params.append(info)
	return params


def _register_tool_meta(name: str, description: str, module: str, *, parameters: list[dict] | None = None, returns: str | None = None) -> None:
	"""Register tool metadata for discovery without duplicating entries."""
	key = f"{module}:{name}"
	if key in _TOOL_KEYS:
		for entry in REGISTERED_TOOL_SPECS:
			if entry.get("module") == module and entry.get("name") == name:
				if description:
					entry.setdefault("description", description)
				if parameters is not None:
					entry["parameters"] = parameters
				if returns is not None:
					entry["returns"] = returns
				return
	_TOOL_KEYS.add(key)
	record = {"name": name, "description": description, "module": module}
	if parameters is not None:
		record["parameters"] = parameters
	if returns is not None:
		record["returns"] = returns
	REGISTERED_TOOL_SPECS.append(record)


def _iter_tool_modules() -> list[ModuleType]:
	modules: list[ModuleType] = []
	package_name = __name__
	package = importlib.import_module(package_name)
	for finder, name, ispkg in pkgutil.iter_modules(package.__path__, package_name + "."):
		if name.endswith(".__pycache__"):
			continue
		try:
			mod = importlib.import_module(name)
			modules.append(mod)
		except Exception:
			# Skip modules that fail to import; tool discovery should degrade gracefully
			continue
	return modules


def auto_register_tools(mcp: object) -> None:
	"""Auto-discover and register all tools that expose a register(mcp) function.

	Each module in this package may optionally define `register(mcp)`.
	This keeps registration centralized and allows easy future extensions.
	"""
	for mod in _iter_tool_modules():
		register: Callable | None = getattr(mod, "register", None)  # type: ignore[arg-type]
		if callable(register):
			register(mcp)


def register_db_tools(mcp: object) -> None:
	"""Register DB-related tools for health and migrations."""
	from ..db.postgres import health_check, run_migrations

	@mcp.tool()
	def db_health() -> dict:
		return health_check()

	@mcp.tool()
	def db_migrate() -> dict:
		applied = run_migrations()
		return {"status": "ok", "applied": applied}

	# Register metadata for discovery
	_register_tool_meta(
		"db_health",
		"Database health check",
		__name__,
		parameters=_extract_parameters(db_health),
		returns="dict",
	)
	_register_tool_meta(
		"db_migrate",
		"Apply pending SQL migrations",
		__name__,
		parameters=_extract_parameters(db_migrate),
		returns="dict",
	)


def get_registered_tool_specs() -> list[dict]:
	"""Return a copy of the registered tool specs (deduplicated)."""
	return list(REGISTERED_TOOL_SPECS)


def discover_tool_specs_via_dummy() -> list[dict]:
	"""Discover tool metadata by registering modules into a dummy MCP object.

	The dummy MCP's tool decorator captures function name, docstring, and module.
	This avoids needing a running MCP server and works within the web process.
	"""

	class _DummyMCP:
		def tool(self, *args, **kwargs):  # parity with FastMCP signature
			def decorator(fn):
				desc = (fn.__doc__ or "").strip()
				params = _extract_parameters(fn)
				ret = fn.__annotations__.get("return") if hasattr(fn, "__annotations__") else None
				rtype = getattr(ret, "__name__", None) if ret not in (None, inspect._empty) else None
				_register_tool_meta(fn.__name__, desc, fn.__module__, parameters=params, returns=rtype)
				return fn
			return decorator

	# Perform discovery; dedupe is handled by _register_tool_meta
	auto_register_tools(_DummyMCP())
	register_db_tools(_DummyMCP())
	return get_registered_tool_specs()


def invoke_tool_via_dummy(tool_name: str, **kwargs):
	"""Invoke a registered MCP tool by name using a dummy MCP to capture functions.

	This avoids running a separate MCP server process in Cloud Run. Tools are
	registered in-process and looked up by their function name.
	"""
	registry: dict[str, object] = {}

	class _ExecMCP:
		def tool(self, *args, **kws):  # mimic FastMCP signature
			def decorator(fn):
				registry.setdefault(fn.__name__, fn)
				return fn
			return decorator

	# Register all tools into the exec registry
	auto_register_tools(_ExecMCP())
	register_db_tools(_ExecMCP())
	fn = registry.get(tool_name)
	if not fn:
		raise ValueError(f"Tool not found: {tool_name}")
	return fn, kwargs
