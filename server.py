from __future__ import annotations

from gasable_hub.server import mcp
from gasable_hub.tools import auto_register_tools, register_db_tools
from gasable_hub.config import get_settings
from gasable_hub.db.postgres import run_migrations

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
