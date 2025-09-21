from mcp.server.fastmcp import FastMCP
from .tools import auto_register_tools, register_db_tools
from .config import get_settings
from .db.postgres import run_migrations


mcp = FastMCP("gasable-hub")


@mcp.tool()
def health() -> str:
	"""Simple health check."""
	return "ok"


if __name__ == "__main__":
	auto_register_tools(mcp)
	register_db_tools(mcp)
	settings = get_settings()
	if settings.db_auto_migrate:
		try:
			applied = run_migrations(settings.migrations_dir)
			if applied:
				print(f"Applied migrations: {applied}")
		except Exception as e:
			print(f"Migration error: {e}")
	mcp.run()


