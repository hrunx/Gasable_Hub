#!/usr/bin/env python3
"""
Update OpenAI Assistant with latest system prompt from database.

Usage:
    python scripts/update_agent_assistant.py support
    python scripts/update_agent_assistant.py --all
"""

import os
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from openai import OpenAI
from gasable_hub.db.postgres import connect as pg_connect


def update_assistant(agent_id: str):
    """Update OpenAI Assistant for a specific agent."""
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    
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
                WHERE id = %s
            """, (agent_id,))
            row = cur.fetchone()
            
            if not row:
                print(f"❌ Agent '{agent_id}' not found")
                return False
            
            aid, display, prompt, model, asst_id = row
            
            if not asst_id:
                print(f"❌ Agent '{agent_id}' has no assistant_id (not provisioned)")
                return False
            
            print(f"\n🔄 Updating Assistant for: {display} ({aid})")
            print(f"   Assistant ID: {asst_id}")
            print(f"   Model: {model or 'gpt-4o'}")
            print(f"   Prompt length: {len(prompt)} chars")
            
            # Update the assistant
            assistant = client.beta.assistants.update(
                assistant_id=asst_id,
                instructions=prompt,
                model=model or "gpt-4o",
                name=display or f"Gasable {aid}",
            )
            
            print(f"✅ Assistant updated successfully!")
            print(f"   New instructions length: {len(assistant.instructions or '')} chars")
            
            return True


def update_all_assistants():
    """Update all OpenAI Assistants."""
    with pg_connect() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id 
                FROM public.gasable_agents
                WHERE assistant_id IS NOT NULL AND assistant_id != ''
                ORDER BY id
            """)
            agent_ids = [row[0] for row in cur.fetchall()]
    
    print(f"\n🔄 Updating {len(agent_ids)} assistants...")
    
    success_count = 0
    for agent_id in agent_ids:
        if update_assistant(agent_id):
            success_count += 1
    
    print(f"\n{'='*60}")
    print(f"✅ Updated {success_count}/{len(agent_ids)} assistants")
    print(f"{'='*60}\n")


def main():
    """Main entry point."""
    if not os.getenv("OPENAI_API_KEY"):
        print("❌ OPENAI_API_KEY not set")
        return 1
    
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python scripts/update_agent_assistant.py <agent_id>")
        print("  python scripts/update_agent_assistant.py --all")
        print("\nExamples:")
        print("  python scripts/update_agent_assistant.py support")
        print("  python scripts/update_agent_assistant.py research")
        print("  python scripts/update_agent_assistant.py --all")
        return 1
    
    arg = sys.argv[1]
    
    if arg in ("--all", "-a"):
        update_all_assistants()
    else:
        if not update_assistant(arg):
            return 1
    
    return 0


if __name__ == "__main__":
    sys.exit(main())

