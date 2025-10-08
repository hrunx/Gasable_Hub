import os, json
from gasable_hub.db.postgres import run_migrations, connect
applied = run_migrations("migrations")
print(json.dumps({"applied": applied}))
with connect() as conn:
    with conn.cursor() as cur:
        # List unapplied migrations (should be none)
        cur.execute("SELECT id FROM public.schema_migrations ORDER BY id")
        done = [r[0] for r in cur.fetchall()]
        print(json.dumps({"schema_migrations": done}))
        # Check core tables
        def exists(schema, table):
            cur.execute("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema=%s AND table_name=%s)", (schema, table))
            return bool(cur.fetchone()[0])
        checks = {t: exists(public, t) for t in (
            gasable_agents,gasable_workflows,gasable_index,credentials,nodes,templates,orchestrator_sessions
        )}
        print(json.dumps({"tables": checks}))
        # Try a roundtrip upsert on agents
        cur.execute(
            """
            INSERT INTO public.gasable_agents (id, display_name, namespace, system_prompt, tool_allowlist)
            VALUES (%s,%s,%s,%s,%s)
            ON CONFLICT (id) DO UPDATE SET display_name=EXCLUDED.display_name, namespace=EXCLUDED.namespace, system_prompt=EXCLUDED.system_prompt, tool_allowlist=EXCLUDED.tool_allowlist, updated_at=now()
            """,
            (_verify_ui_save, Verify
