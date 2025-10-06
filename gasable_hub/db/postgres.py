from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Iterable

import psycopg2
import psycopg2.extras

from ..config import get_settings


@dataclass
class PgConnInfo:
    host: str
    port: int
    user: str
    password: str
    dbname: str


def get_connection_params() -> PgConnInfo:
    settings = get_settings()
    return PgConnInfo(
        host=settings.pg_host,
        port=settings.pg_port,
        user=settings.pg_user,
        password=settings.pg_password,
        dbname=settings.pg_dbname,
    )


def connect(dbname_override: str | None = None):
    dsn = os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL") or os.getenv("NETLIFY_DATABASE_URL")
    if dsn:
        return psycopg2.connect(dsn, cursor_factory=psycopg2.extras.DictCursor)
    info = get_connection_params()
    sslmode = os.getenv("PG_SSLMODE") or None
    conn_kwargs = dict(
        host=info.host,
        port=info.port,
        user=info.user,
        password=info.password,
        database=dbname_override or info.dbname,
        cursor_factory=psycopg2.extras.DictCursor,
    )
    if sslmode:
        conn_kwargs["sslmode"] = sslmode
    return psycopg2.connect(**conn_kwargs)


def run_sql(sql: str) -> None:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
            conn.commit()


def run_migrations(migrations_dir: str | None = None) -> list[str]:
    """Apply .sql files in lexical order; create schema_migrations table if missing."""
    settings = get_settings()
    dir_path = migrations_dir or settings.migrations_dir
    os.makedirs(dir_path, exist_ok=True)
    applied: list[str] = []
    # Optional controls via env:
    # - SKIP_MIGRATIONS: comma-separated list of filenames to skip
    # - ALLOW_DESTRUCTIVE_MIGRATIONS: set to 1/true to allow DROP/ALTER DROP
    skip_set = {name.strip() for name in (os.getenv("SKIP_MIGRATIONS") or "").split(",") if name.strip()}
    allow_destructive = (os.getenv("ALLOW_DESTRUCTIVE_MIGRATIONS", "0") in ("1", "true", "True"))

    def _is_destructive(sql: str) -> bool:
        lowered = sql.lower()
        if "drop table" in lowered or "drop index" in lowered:
            return True
        if "alter table" in lowered and " drop " in lowered:
            return True
        return False
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS public.schema_migrations (
                    id text PRIMARY KEY,
                    applied_at timestamptz NOT NULL DEFAULT now()
                );
                """
            )
            conn.commit()
            cur.execute("SELECT id FROM public.schema_migrations")
            done = {row[0] for row in cur.fetchall()}
            for name in sorted(os.listdir(dir_path)):
                if not name.endswith(".sql"):
                    continue
                if name in done:
                    continue
                if name in skip_set:
                    # Explicitly skipped by operator
                    print(f"Skipping migration (operator skip): {name}")
                    continue
                with open(os.path.join(dir_path, name), "r", encoding="utf-8") as f:
                    sql = f.read()
                if not allow_destructive and _is_destructive(sql):
                    print(
                        f"Skipping destructive migration: {name} (set ALLOW_DESTRUCTIVE_MIGRATIONS=1 to apply)"
                    )
                    continue
                cur.execute(sql)
                cur.execute(
                    "INSERT INTO public.schema_migrations (id) VALUES (%s)",
                    (name,),
                )
                conn.commit()
                applied.append(name)
    return applied


def health_check() -> dict:
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
        return {"status": "ok"}
    except Exception as e:
        return {"status": "error", "error": str(e)}

