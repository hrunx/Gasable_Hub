import importlib
import pkgutil
from types import ModuleType
from typing import Callable


# Simple in-process registry to expose tool metadata to the web UI
REGISTERED_TOOL_SPECS: list[dict] = []
_TOOL_KEYS: set[str] = set()


def _register_tool_meta(name: str, description: str, module: str) -> None:
	"""Register tool metadata for discovery without duplicating entries.

	This allows a separate process (e.g., FastAPI web UI) to import this package,
	perform registrations into a dummy MCP instance, and still discover tool
	metadata deterministically.
	"""
	key = f"{module}:{name}"
	if key in _TOOL_KEYS:
		return
	_TOOL_KEYS.add(key)
	REGISTERED_TOOL_SPECS.append({"name": name, "description": description, "module": module})


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
	_register_tool_meta("db_health", "Database health check", __name__)
	_register_tool_meta("db_migrate", "Apply pending SQL migrations", __name__)


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
				_register_tool_meta(fn.__name__, desc, fn.__module__)
				return fn
			return decorator

	# Perform discovery; dedupe is handled by _register_tool_meta
	auto_register_tools(_DummyMCP())
	register_db_tools(_DummyMCP())
	return get_registered_tool_specs()


