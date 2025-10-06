from __future__ import annotations

import os
import subprocess
import sys
import time
from dotenv import load_dotenv
import json


def ensure_postgres_started():
    # Prefer Postgres 17 which has pgvector installed on this system
    os.environ["PATH"] = "/opt/homebrew/opt/postgresql@17/bin:" + os.environ.get("PATH", "")
    try:
        subprocess.run(["brew", "services", "start", "postgresql@17"], check=False, stdout=subprocess.DEVNULL)
    except Exception:
        pass
    for _ in range(20):
        p = subprocess.run(["psql", "-U", os.getenv("USER", "postgres"), "-d", "postgres", "-c", "SELECT 1"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if p.returncode == 0:
            return
        time.sleep(0.5)
    raise RuntimeError("Postgres did not become ready")


def apply_migrations():
    user = os.getenv("USER", "postgres")
    db = os.getenv("PG_DBNAME", "gasable_db")
    # Create db if missing
    probes = subprocess.run(["psql", "-U", user, "-d", "postgres", "-tAc", f"SELECT 1 FROM pg_database WHERE datname='{db}'"], capture_output=True, text=True)
    if "1" not in probes.stdout:
        subprocess.run(["createdb", "-U", user, db], check=True)
    # Enable extension
    subprocess.run(["psql", "-U", user, "-d", db, "-v", "ON_ERROR_STOP=1", "-c", "CREATE EXTENSION IF NOT EXISTS vector;"], check=True)
    # Apply sql files
    for name in sorted(os.listdir("migrations")):
        if not name.endswith(".sql"):
            continue
        path = os.path.join("migrations", name)
        subprocess.run(["psql", "-U", user, "-d", db, "-v", "ON_ERROR_STOP=1", "-f", path], check=True)


def run_mcp_server():
    # Run MCP server in a subprocess
    return subprocess.Popen([sys.executable, "server.py"])  # uses gasable_hub.server entrypoint


def run_web_ui():
    # Run FastAPI app (webapp.py) via uvicorn
    args = [
        sys.executable,
        "-m",
        "uvicorn",
        "webapp:app",
        "--host",
        "127.0.0.1",
        "--port",
        os.getenv("WEB_PORT", "8000"),
    ]
    if os.getenv("WEB_RELOAD", "0") in ("1", "true", "True"):
        args.append("--reload")
    return subprocess.Popen(args)


def main():
    load_dotenv(override=True)
    ensure_postgres_started()
    apply_migrations()
    os.environ.setdefault("DB_AUTO_MIGRATE", "1")
    mcp = run_mcp_server()
    web = run_web_ui()
    # Persist PIDs for the web UI to read
    try:
        os.makedirs("storage", exist_ok=True)
        with open("storage/pids.json", "w", encoding="utf-8") as f:
            json.dump({"mcp_pid": mcp.pid, "web_pid": web.pid}, f)
    except Exception:
        pass
    print("Gasable Hub is running:")
    print("- MCP server: embedded")
    print("- Web UI: http://127.0.0.1:" + os.getenv("WEB_PORT", "8000"))
    try:
        mcp.wait()
        web.wait()
    except KeyboardInterrupt:
        mcp.terminate()
        web.terminate()


if __name__ == "__main__":
    main()


