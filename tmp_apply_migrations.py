import os, json
from gasable_hub.db.postgres import run_migrations, connect
applied = run_migrations("migrations")
print(json.dumps({"applied": applied}))
with connect() as conn:
    with conn.cursor() as cur:
        def exists(schema, table):
            cur.execute("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema=%s AND table_name=%s)", (schema, table))
            return bool(cur.fetchone()[0])
        res = {
            "gasable_agents": exists(public,gasable_agents),
            "orchestrator_sessions": exists(public,orchestrator_sessions),
            "gasable_workflows": exists(public,gasable_workflows),
        }
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_schema=%s AND table_name=%s ORDER BY ordinal_position", (public,gasable_agents))
        cols = [r[0] for r in cur.fetchall()]
        print(json.dumps({"tables": res, "gasable_agents_columns": cols}))
