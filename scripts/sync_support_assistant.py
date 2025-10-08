#!/usr/bin/env python3
"""Update Support Agent's OpenAI Assistant with latest prompt from database."""

import os
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Load .env file
env_file = Path(__file__).parent.parent / ".env"
if env_file.exists():
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

# Set database URL if not already set
if not os.getenv("SUPABASE_DB_URL"):
    os.environ["SUPABASE_DB_URL"] = "postgresql://postgres:GASABLEHUB@db.lopbyztcrrngppnvajis.supabase.co:5432/postgres?sslmode=require"

from openai import OpenAI
from gasable_hub.db.postgres import connect as pg_connect

# Get the support agent details
with pg_connect() as conn:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT 
                id, 
                display_name, 
                system_prompt, 
                answer_model,
                assistant_id
            FROM public.gasable_agents
            WHERE id = 'support'
        """)
        row = cur.fetchone()

if not row:
    print("❌ Support agent not found")
    sys.exit(1)

aid, display, prompt, model, asst_id = row

if not asst_id:
    print("❌ Support agent has no assistant_id")
    sys.exit(1)

print(f"🔄 Updating Assistant for: {display} ({aid})")
print(f"   Assistant ID: {asst_id}")
print(f"   Model: {model or 'gpt-4o'}")
print(f"   New prompt length: {len(prompt)} chars")

# Update the assistant
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
assistant = client.beta.assistants.update(
    assistant_id=asst_id,
    instructions=prompt,
    model=model or "gpt-4o",
    name=display or f"Gasable {aid}",
)

print(f"✅ Assistant updated successfully!")
print(f"   Instructions length: {len(assistant.instructions or '')} chars")
print(f"\n🎯 Test it now:")
print(f"   1. Go to http://localhost:3000")
print(f"   2. Select 'Support Agent' from the right sidebar")
print(f"   3. Ask: 'What IoT services does Gasable offer?'")
print(f"   4. Agent should now search knowledge base without asking for identity")

